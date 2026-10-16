import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config, requireJwtSecret } from './config.js'
import { authenticate, allowRoles } from './auth.js'
import { pool } from './db.js'

const app = express()
const staff = [authenticate]
const canManage = [authenticate, allowRoles('Administrator', 'Librarian')]
const canAdminister = [authenticate, allowRoles('Administrator')]

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

app.use(helmet())
app.use(cors({ origin: config.clientUrl }))
app.use(express.json({ limit: '1mb' }))

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function audit(connection, actor, action, details) {
  return connection.execute(
    'INSERT INTO audit_logs (actor, action, details) VALUES (?, ?, ?)',
    [actor, action, details],
  )
}

function validateBook(body) {
  const isbn = String(body.isbn || '').trim()
  const title = String(body.title || '').trim()
  const author = String(body.author || '').trim()
  const category = String(body.category || 'General').trim()
  const shelf = String(body.shelf || 'Unassigned').trim()
  const totalCopies = Number(body.totalCopies)
  const publishedOn = body.publishedOn ? String(body.publishedOn) : null

  if (!isbn || !title || !author || !Number.isInteger(totalCopies) || totalCopies < 1 || totalCopies > 10000) {
    return { error: 'ISBN, title, author, and a copy count between 1 and 10,000 are required.' }
  }
  if (publishedOn && !/^\d{4}-\d{2}-\d{2}$/.test(publishedOn)) {
    return { error: 'Publication date must use YYYY-MM-DD.' }
  }

  return { value: { isbn, title, author, category, shelf, totalCopies, publishedOn } }
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1')
  res.json({ status: 'ok', database: 'connected' })
}))

app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase()
  const password = String(req.body.password || '')
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }
  const [users] = await pool.execute(
    'SELECT id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1',
    [email],
  )
  const user = users[0]
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect.' })
  }

  requireJwtSecret()
  const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role }
  const token = jwt.sign(publicUser, config.jwtSecret, { expiresIn: '8h' })
  res.json({ token, user: publicUser })
}))

app.get('/api/auth/me', ...staff, (_req, res) => res.json({ user: _req.user }))

app.get('/api/dashboard', ...staff, asyncRoute(async (_req, res) => {
  const [[summary]] = await pool.query(
    `SELECT
      (SELECT COALESCE(SUM(total_copies), 0) FROM books) AS totalBooks,
      (SELECT COALESCE(SUM(available_copies), 0) FROM books) AS availableBooks,
      (SELECT COUNT(*) FROM loans WHERE returned_at IS NULL) AS activeLoans,
      (SELECT COUNT(*) FROM loans WHERE returned_at IS NULL AND due_date < CURRENT_DATE()) AS overdueLoans,
      (SELECT COUNT(*) FROM members WHERE status = 'Active') AS activeMembers`,
  )
  const [monthlyRows] = await pool.query(
    `SELECT DATE_FORMAT(issued_at, '%Y-%m') AS monthKey, COUNT(*) AS total
     FROM loans
     WHERE issued_at >= DATE_SUB(CURRENT_DATE(), INTERVAL 5 MONTH)
     GROUP BY monthKey ORDER BY monthKey`,
  )
  const monthlyCounts = new Map(monthlyRows.map((row) => [row.monthKey, Number(row.total)]))
  const chart = Array.from({ length: 6 }, (_, index) => {
    const month = new Date()
    month.setDate(1)
    month.setMonth(month.getMonth() - (5 - index))
    const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`
    return {
      month: month.toLocaleString('en', { month: 'short' }),
      value: monthlyCounts.get(monthKey) || 0,
    }
  })
  res.json({ ...summary, ...Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value)])), chart })
}))

app.get('/api/books', ...staff, asyncRoute(async (req, res) => {
  const search = `%${String(req.query.search || '').trim()}%`
  const [books] = await pool.execute(
    `SELECT id, isbn, title, author, category, shelf,
       total_copies AS totalCopies, available_copies AS availableCopies,
       published_on AS publishedOn
     FROM books
     WHERE title LIKE ? OR author LIKE ? OR isbn LIKE ? OR category LIKE ?
     ORDER BY title`,
    [search, search, search, search],
  )
  res.json(books.map((book) => ({ ...book, id: Number(book.id) })))
}))

app.post('/api/books', ...canManage, asyncRoute(async (req, res) => {
  const { value, error } = validateBook(req.body)
  if (error) return res.status(400).json({ error })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [result] = await connection.execute(
      `INSERT INTO books
       (isbn, title, author, category, shelf, total_copies, available_copies, published_on)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.isbn, value.title, value.author, value.category, value.shelf, value.totalCopies, value.totalCopies, value.publishedOn],
    )
    await audit(connection, req.user.name, 'Book added', `Added "${value.title}" to the catalog`)
    await connection.commit()
    res.status(201).json({ id: result.insertId, ...value, availableCopies: value.totalCopies })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That ISBN is already in the catalog.' })
    throw error
  } finally {
    connection.release()
  }
}))

app.put('/api/books/:id', ...canManage, asyncRoute(async (req, res) => {
  const { value, error } = validateBook(req.body)
  if (error) return res.status(400).json({ error })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[book]] = await connection.execute(
      `SELECT b.id, b.available_copies,
       (SELECT COUNT(*) FROM loans WHERE book_id = b.id AND returned_at IS NULL) AS borrowed
       FROM books b WHERE b.id = ? FOR UPDATE`,
      [req.params.id],
    )
    if (!book) {
      await connection.rollback()
      return res.status(404).json({ error: 'Book not found.' })
    }
    const borrowed = Number(book.borrowed)
    if (value.totalCopies < borrowed) {
      await connection.rollback()
      return res.status(400).json({ error: `At least ${borrowed} copies are currently on loan.` })
    }
    const availableCopies = value.totalCopies - borrowed
    await connection.execute(
      `UPDATE books SET isbn = ?, title = ?, author = ?, category = ?, shelf = ?,
       total_copies = ?, available_copies = ?, published_on = ? WHERE id = ?`,
      [value.isbn, value.title, value.author, value.category, value.shelf, value.totalCopies, availableCopies, value.publishedOn, req.params.id],
    )
    await audit(connection, req.user.name, 'Book updated', `Updated "${value.title}" in the catalog`)
    await connection.commit()
    res.json({ id: Number(req.params.id), ...value, availableCopies })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That ISBN is already in the catalog.' })
    throw error
  } finally {
    connection.release()
  }
}))

app.delete('/api/books/:id', ...canAdminister, asyncRoute(async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM books WHERE id = ?', [req.params.id])
    if (!result.affectedRows) return res.status(404).json({ error: 'Book not found.' })
    await audit(pool, req.user.name, 'Book removed', `Removed book #${req.params.id} from the catalog`)
    res.status(204).end()
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ error: 'This book has loan history and cannot be removed.' })
    }
    throw error
  }
}))

app.get('/api/members', ...staff, asyncRoute(async (req, res) => {
  const search = `%${String(req.query.search || '').trim()}%`
  const [members] = await pool.execute(
    `SELECT id, membership_number AS membershipNumber, name, email, status,
       DATE_FORMAT(joined_at, '%Y-%m-%d') AS joinedAt
     FROM members WHERE name LIKE ? OR email LIKE ? OR membership_number LIKE ?
     ORDER BY name`,
    [search, search, search],
  )
  res.json(members.map((member) => ({ ...member, id: Number(member.id) })))
}))

app.post('/api/members', ...canManage, asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim()
  const email = String(req.body.email || '').trim().toLowerCase()
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a member name and a valid email address.' })
  }

  try {
    const membershipNumber = `M-${Date.now().toString().slice(-8)}`
    const [result] = await pool.execute(
      'INSERT INTO members (membership_number, name, email) VALUES (?, ?, ?)',
      [membershipNumber, name, email],
    )
    await audit(pool, req.user.name, 'Member added', `Registered ${name} as a library member`)
    res.status(201).json({
      id: result.insertId,
      membershipNumber,
      name,
      email,
      status: 'Active',
      joinedAt: formatLocalDate(new Date()),
    })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A member with that email already exists.' })
    throw error
  }
}))

app.delete('/api/members/:id', ...canAdminister, asyncRoute(async (req, res) => {
  try {
    const [result] = await pool.execute('DELETE FROM members WHERE id = ?', [req.params.id])
    if (!result.affectedRows) return res.status(404).json({ error: 'Member not found.' })
    await audit(pool, req.user.name, 'Member removed', `Removed member #${req.params.id}`)
    res.status(204).end()
  } catch (error) {
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ error: 'This member has loan history and cannot be removed.' })
    }
    throw error
  }
}))

app.get('/api/loans', ...staff, asyncRoute(async (req, res) => {
  const filter = req.query.status
  const overdueOnly = filter === 'Overdue'
  const activeOnly = filter === 'Active'
  const where = overdueOnly
    ? 'WHERE l.returned_at IS NULL AND l.due_date < CURRENT_DATE()'
    : activeOnly
      ? 'WHERE l.returned_at IS NULL AND l.due_date >= CURRENT_DATE()'
      : ''
  const [loans] = await pool.query(
    `SELECT l.id, b.id AS bookId, b.title AS bookTitle, b.isbn,
       m.id AS memberId, m.name AS memberName, m.membership_number AS membershipNumber,
       DATE_FORMAT(l.issued_at, '%Y-%m-%d') AS issuedAt,
       DATE_FORMAT(l.due_date, '%Y-%m-%d') AS dueDate,
       DATE_FORMAT(l.returned_at, '%Y-%m-%d') AS returnedAt,
       CASE WHEN l.returned_at IS NOT NULL THEN 'Returned'
            WHEN l.due_date < CURRENT_DATE() THEN 'Overdue' ELSE 'Active' END AS status
     FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id
     ${where} ORDER BY l.issued_at DESC`,
  )
  res.json(loans.map((loan) => ({ ...loan, id: Number(loan.id), bookId: Number(loan.bookId), memberId: Number(loan.memberId) })))
}))

app.post('/api/loans', ...canManage, asyncRoute(async (req, res) => {
  const bookId = Number(req.body.bookId)
  const memberId = Number(req.body.memberId)
  const dueDate = String(req.body.dueDate || '')
  if (!Number.isInteger(bookId) || !Number.isInteger(memberId) || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return res.status(400).json({ error: 'Choose a book, a member, and a valid due date.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[book]] = await connection.execute(
      'SELECT id, title, available_copies FROM books WHERE id = ? FOR UPDATE',
      [bookId],
    )
    if (!book) {
      await connection.rollback()
      return res.status(404).json({ error: 'Book not found.' })
    }
    if (book.available_copies < 1) {
      await connection.rollback()
      return res.status(409).json({ error: 'There are no available copies of this book.' })
    }
    const [[member]] = await connection.execute(
      'SELECT id, name FROM members WHERE id = ? AND status = ?',
      [memberId, 'Active'],
    )
    if (!member) {
      await connection.rollback()
      return res.status(404).json({ error: 'Active member not found.' })
    }

    const [result] = await connection.execute(
      'INSERT INTO loans (book_id, member_id, due_date) VALUES (?, ?, ?)',
      [bookId, memberId, dueDate],
    )
    await connection.execute(
      'UPDATE books SET available_copies = available_copies - 1 WHERE id = ?',
      [bookId],
    )
    await audit(connection, req.user.name, 'Book checked out', `"${book.title}" checked out to ${member.name}`)
    await connection.commit()
    res.status(201).json({ id: result.insertId, bookId, memberId, bookTitle: book.title, memberName: member.name, dueDate, status: 'Active' })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}))

app.post('/api/loans/:id/return', ...canManage, asyncRoute(async (req, res) => {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[loan]] = await connection.execute(
      `SELECT l.id, l.book_id AS bookId, l.returned_at AS returnedAt, b.title
       FROM loans l JOIN books b ON b.id = l.book_id WHERE l.id = ? FOR UPDATE`,
      [req.params.id],
    )
    if (!loan) {
      await connection.rollback()
      return res.status(404).json({ error: 'Loan not found.' })
    }
    if (loan.returnedAt) {
      await connection.rollback()
      return res.status(409).json({ error: 'This book has already been returned.' })
    }
    await connection.execute('UPDATE loans SET returned_at = CURRENT_TIMESTAMP WHERE id = ?', [loan.id])
    await connection.execute(
      'UPDATE books SET available_copies = LEAST(total_copies, available_copies + 1) WHERE id = ?',
      [loan.bookId],
    )
    await audit(connection, req.user.name, 'Book returned', `"${loan.title}" returned to the library`)
    await connection.commit()
    res.json({ message: 'Book returned successfully.' })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}))

app.get('/api/audit', ...staff, asyncRoute(async (_req, res) => {
  const [entries] = await pool.query(
    `SELECT id, actor, action, details,
       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i') AS time
     FROM audit_logs ORDER BY created_at DESC LIMIT 8`,
  )
  res.json(entries)
}))

app.get('/api/export/books.csv', ...staff, asyncRoute(async (_req, res) => {
  const [books] = await pool.query(
    `SELECT isbn, title, author, category, shelf,
       total_copies AS total_copies, available_copies AS available_copies
     FROM books ORDER BY title`,
  )
  const escapeCsv = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const columns = ['isbn', 'title', 'author', 'category', 'shelf', 'total_copies', 'available_copies']
  const csv = [columns.join(','), ...books.map((book) => columns.map((column) => escapeCsv(book[column])).join(','))].join('\r\n')
  res.type('text/csv').attachment('library-catalog.csv').send(csv)
}))

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}.` }))

app.use((error, _req, res, _next) => {
  if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_DB_ERROR') {
    console.error('Database is not initialized. Run "npm run db:setup" from the project root.')
    return res.status(503).json({ error: 'Database is not initialized. Run npm run db:setup.' })
  }
  console.error(error)
  return res.status(500).json({ error: 'An unexpected server error occurred.' })
})

async function start() {
  requireJwtSecret()
  await pool.query('SELECT 1')
  app.listen(config.port, () => {
    console.log(`Library API listening at http://localhost:${config.port}`)
  })
}

start().catch((error) => {
  console.error(`Could not start the API: ${error.message}`)
  console.error('Check MySQL is running, your root .env settings, and run npm run db:setup.')
  process.exitCode = 1
})
