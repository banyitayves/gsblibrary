import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { randomBytes } from 'node:crypto'
import { config, requireJwtSecret } from './config.js'
import { authenticate, allowRoles } from './auth.js'
import { pool } from './db.js'
import { csvDocument, parseCsv } from './csv.js'

const app = express()
const staff = [authenticate]
const canManage = [authenticate, allowRoles('Administrator', 'Librarian')]
const canAdminister = [authenticate, allowRoles('Administrator')]
const schoolClasses = [
  'S1A', 'S1B', 'S1C', 'S1D', 'S1E', 'S1F',
  'S2A', 'S2B', 'S2C', 'S2D',
  'S3A', 'S3B', 'S3C', 'S3D',
  'S4LANG', 'S4ARTS', 'S4MS2',
  'S5LANG', 'S5ARTS', 'S5MS2',
  'S6LFK', 'S6HGL', 'S6MCE',
]
const allowedOrigins = new Set([
  ...config.clientUrls,
  ...[process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
    .filter(Boolean)
    .map((hostname) => `https://${hostname}`),
])

function formatLocalDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

app.use(helmet())
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin))
  },
}))
app.use(express.json({ limit: '5mb' }))
app.use(express.text({ type: 'text/csv', limit: '5mb' }))

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

function audit(connection, actor, action, details) {
  return connection.execute(
    'INSERT INTO audit_logs (actor, action, details) VALUES (?, ?, ?)',
    [actor, action, details],
  )
}

function membershipNumberFor(memberType) {
  const prefix = memberType === 'Teacher' ? 'TCH' : 'STU'
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`
}

function validateMember(data) {
  const name = String(data.name || '').trim()
  const memberType = String(data.member_type ?? data.memberType ?? 'Student').trim()
  const classSection = String(data.class_section ?? data.classSection ?? '').trim().toUpperCase()
  const membershipNumber = String(data.membership_number ?? data.membershipNumber ?? '').trim()
  const emailValue = String(data.email || '').trim().toLowerCase()
  const email = emailValue || null

  if (!name || name.length > 120) return { error: 'Name is required and must be at most 120 characters.' }
  if (!['Student', 'Teacher'].includes(memberType)) return { error: 'Member type must be Student or Teacher.' }
  if (email && (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { error: 'Email must be a valid address or left blank.' }
  }
  if (membershipNumber.length > 32) return { error: 'Membership number must be at most 32 characters.' }
  if (memberType === 'Student' && !schoolClasses.includes(classSection)) {
    return { error: `Choose a student class from: ${schoolClasses.join(', ')}.` }
  }
  if (memberType === 'Teacher' && classSection) {
    return { error: 'Teacher records should not have a student class.' }
  }
  return {
    value: {
      name,
      memberType,
      classSection: memberType === 'Student' ? classSection : null,
      membershipNumber: membershipNumber || membershipNumberFor(memberType),
      email,
    },
  }
}

function reportFilters(query, includeStatus = true) {
  const conditions = []
  const params = []
  const from = String(query.from || '')
  const to = String(query.to || '')
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return { error: 'Report dates must use YYYY-MM-DD.' }
  }
  if (from && to && from > to) return { error: 'The start date must not be after the end date.' }
  if (from) {
    conditions.push('l.issued_at >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('l.issued_at < DATE_ADD(?, INTERVAL 1 DAY)')
    params.push(to)
  }

  const search = String(query.search || '').trim()
  if (search) {
    conditions.push('(m.name LIKE ? OR m.membership_number LIKE ? OR b.title LIKE ? OR b.isbn LIKE ?)')
    const term = `%${search}%`
    params.push(term, term, term, term)
  }
  const classSection = String(query.classSection || '').trim().toUpperCase()
  if (classSection) {
    if (!schoolClasses.includes(classSection)) return { error: 'Select a valid student class.' }
    conditions.push('m.class_section = ?')
    params.push(classSection)
  }
  if (query.memberType && ['Student', 'Teacher'].includes(query.memberType)) {
    conditions.push('m.member_type = ?')
    params.push(query.memberType)
  }
  if (includeStatus) {
    if (query.status === 'Active') conditions.push('l.returned_at IS NULL AND l.due_date >= CURRENT_DATE()')
    else if (query.status === 'Overdue') conditions.push('l.returned_at IS NULL AND l.due_date < CURRENT_DATE()')
    else if (query.status === 'Returned') conditions.push('l.returned_at IS NOT NULL')
    else if (query.status && query.status !== 'All') return { error: 'Choose a valid report status.' }
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

const loanReportSelect = `SELECT l.id, b.title AS bookTitle, b.isbn,
  m.id AS memberId, m.name AS memberName, m.membership_number AS membershipNumber,
  m.member_type AS memberType, m.class_section AS classSection, m.email,
  DATE_FORMAT(l.issued_at, '%Y-%m-%d') AS issuedAt,
  DATE_FORMAT(l.due_date, '%Y-%m-%d') AS dueDate,
  DATE_FORMAT(l.returned_at, '%Y-%m-%d') AS returnedAt,
  CASE WHEN l.returned_at IS NOT NULL THEN 'Returned'
       WHEN l.due_date < CURRENT_DATE() THEN 'Overdue' ELSE 'Active' END AS status
  FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id`

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
  const email = String(req.body?.email || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!email || !password) {
    return res.status(400).json({ error: 'Username and password are required.' })
  }
  const [users] = await pool.execute(
    'SELECT id, name, email, password_hash, role FROM users WHERE email = ? LIMIT 1',
    [email],
  )
  const user = users[0]
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Username or password is incorrect.' })
  }

  requireJwtSecret()
  const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role }
  const token = jwt.sign(publicUser, config.jwtSecret, { expiresIn: '8h' })
  res.json({ token, user: publicUser })
}))

app.get('/api/auth/me', ...staff, (_req, res) => res.json({ user: _req.user }))

app.post('/api/auth/change-credentials', ...staff, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '')
  const username = String(req.body?.username || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  if (!currentPassword || !username || username.length > 190 || !password || Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Current password, a username up to 190 characters, and a new password of 12–72 bytes are required.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[account]] = await connection.execute(
      'SELECT id, name, email, password_hash, role FROM users WHERE id = ? FOR UPDATE',
      [req.user.id],
    )
    if (!account || !(await bcrypt.compare(currentPassword, account.password_hash))) {
      await connection.rollback()
      return res.status(401).json({ error: 'Current password is incorrect.' })
    }
    const [[existing]] = await connection.execute(
      'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
      [username, account.id],
    )
    if (existing) {
      await connection.rollback()
      return res.status(409).json({ error: 'That username is already in use.' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const name = account.role === 'Librarian' ? 'NSHIMIYIMANA Yves' : account.name
    await connection.execute(
      'UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?',
      [name, username, passwordHash, account.id],
    )
    await audit(connection, name, 'Staff login changed', `Updated sign-in credentials for ${name}`)
    await connection.commit()
    res.json({ message: 'Your username and password have been updated. Sign in again to continue.' })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That username is already in use.' })
    throw error
  } finally {
    connection.release()
  }
}))

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
    `SELECT m.id, m.membership_number AS membershipNumber, m.name, m.email,
       m.member_type AS memberType, m.class_section AS classSection, m.status,
       DATE_FORMAT(m.joined_at, '%Y-%m-%d') AS joinedAt,
       (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.id AND l.returned_at IS NULL) AS activeLoans,
       (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.id) AS totalLoans
     FROM members m
     WHERE m.name LIKE ? OR m.email LIKE ? OR m.membership_number LIKE ? OR m.class_section LIKE ?
     ORDER BY name`,
    [search, search, search, search],
  )
  res.json(members.map((member) => ({
    ...member,
    id: Number(member.id),
    activeLoans: Number(member.activeLoans),
    totalLoans: Number(member.totalLoans),
  })))
}))

app.post('/api/members', ...canManage, asyncRoute(async (req, res) => {
  const { value, error } = validateMember(req.body)
  if (error) return res.status(400).json({ error })

  try {
    const [result] = await pool.execute(
      `INSERT INTO members (membership_number, name, email, member_type, class_section)
       VALUES (?, ?, ?, ?, ?)`,
      [value.membershipNumber, value.name, value.email, value.memberType, value.classSection],
    )
    await audit(pool, req.user.name, 'Member added', `Registered ${value.name} as a ${value.memberType.toLowerCase()}`)
    res.status(201).json({
      id: result.insertId,
      ...value,
      status: 'Active',
      joinedAt: formatLocalDate(new Date()),
    })
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That membership number or email is already in use.' })
    throw error
  }
}))

app.post('/api/members/import', ...canManage, asyncRoute(async (req, res) => {
  if (typeof req.body !== 'string' || !req.body.trim()) {
    return res.status(400).json({ error: 'Upload a non-empty CSV file.' })
  }
  let rows
  try {
    rows = parseCsv(req.body.replace(/^\uFEFF/, ''))
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }
  if (rows.length < 2) return res.status(400).json({ error: 'The CSV needs a header row and at least one member row.' })
  if (rows.length > 5001) return res.status(413).json({ error: 'Import up to 5,000 people per CSV file.' })

  const headers = rows[0].map((header) => header.trim().toLowerCase())
  const requiredHeaders = ['name', 'member_type', 'class_section', 'membership_number', 'email']
  if (requiredHeaders.some((header) => !headers.includes(header))) {
    return res.status(400).json({ error: `CSV headers must include: ${requiredHeaders.join(', ')}.` })
  }
  const imported = []
  const skipped = []
  const invalid = []
  const seenNumbers = new Set()
  const seenEmails = new Set()
  const expectedType = String(req.query.type || '').trim()
  if (expectedType && !['Student', 'Teacher'].includes(expectedType)) {
    return res.status(400).json({ error: 'Import type must be Student or Teacher.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    for (let index = 1; index < rows.length; index += 1) {
      const csvRow = rows[index]
      const data = Object.fromEntries(headers.map((header, column) => [header, csvRow[column] || '']))
      const { value, error } = validateMember(data)
      const line = index + 1
      if (error) {
        invalid.push({ line, reason: error })
        continue
      }
      if (expectedType && value.memberType !== expectedType) {
        invalid.push({ line, reason: `This import expects ${expectedType.toLowerCase()} records.` })
        continue
      }
      if (seenNumbers.has(value.membershipNumber) || (value.email && seenEmails.has(value.email))) {
        skipped.push({ line, reason: 'Duplicate membership number or email in this file.' })
        continue
      }
      seenNumbers.add(value.membershipNumber)
      if (value.email) seenEmails.add(value.email)
      const [[duplicate]] = await connection.execute(
        `SELECT membership_number FROM members
         WHERE membership_number = ? OR (? IS NOT NULL AND email = ?) LIMIT 1`,
        [value.membershipNumber, value.email, value.email],
      )
      if (duplicate) {
        skipped.push({ line, reason: 'Membership number or email already exists.' })
        continue
      }
      await connection.execute(
        `INSERT INTO members (membership_number, name, email, member_type, class_section)
         VALUES (?, ?, ?, ?, ?)`,
        [value.membershipNumber, value.name, value.email, value.memberType, value.classSection],
      )
      imported.push({ line, name: value.name, memberType: value.memberType })
    }
    await audit(connection, req.user.name, 'Members imported', `Imported ${imported.length} school member(s)`)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A member was added by another import while this file was processing. Please upload the file again.' })
    }
    throw error
  } finally {
    connection.release()
  }
  res.json({ imported: imported.length, skipped, invalid })
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
       m.member_type AS memberType, m.class_section AS classSection,
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

app.get('/api/reports', ...staff, asyncRoute(async (req, res) => {
  const filters = reportFilters(req.query)
  if (filters.error) return res.status(400).json({ error: filters.error })
  const summaryFilters = reportFilters(req.query, false)
  if (summaryFilters.error) return res.status(400).json({ error: summaryFilters.error })
  const [rows] = await pool.execute(
    `${loanReportSelect} ${filters.where} ORDER BY l.issued_at DESC, m.name LIMIT 20000`,
    filters.params,
  )
  const [[summary]] = await pool.execute(
    `SELECT COUNT(*) AS totalLoans,
       SUM(l.returned_at IS NULL) AS activeLoans,
       SUM(l.returned_at IS NULL AND l.due_date < CURRENT_DATE()) AS overdueLoans,
       SUM(l.returned_at IS NOT NULL) AS returnedLoans,
       SUM(m.member_type = 'Student') AS studentLoans,
       SUM(m.member_type = 'Teacher') AS teacherLoans
     FROM loans l JOIN members m ON m.id = l.member_id
     JOIN books b ON b.id = l.book_id ${summaryFilters.where}`,
    summaryFilters.params,
  )
  res.json({
    summary: Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, Number(value || 0)])),
    rows: rows.map((row) => ({ ...row, id: Number(row.id), memberId: Number(row.memberId) })),
    truncated: rows.length === 20000,
  })
}))

app.get('/api/reports/people', ...staff, asyncRoute(async (req, res) => {
  const conditions = []
  const params = []
  const search = `%${String(req.query.search || '').trim()}%`
  if (req.query.search) {
    conditions.push('(m.name LIKE ? OR m.membership_number LIKE ? OR m.email LIKE ?)')
    params.push(search, search, search)
  }
  const memberType = String(req.query.memberType || '').trim()
  if (memberType && !['Student', 'Teacher'].includes(memberType)) {
    return res.status(400).json({ error: 'Choose Student or Teacher.' })
  }
  if (memberType) {
    conditions.push('m.member_type = ?')
    params.push(memberType)
  }
  const classSection = String(req.query.classSection || '').trim().toUpperCase()
  if (classSection) {
    if (!schoolClasses.includes(classSection)) return res.status(400).json({ error: 'Select a valid student class.' })
    conditions.push('m.class_section = ?')
    params.push(classSection)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [people] = await pool.execute(
    `SELECT m.id, m.name, m.membership_number AS membershipNumber, m.email,
       m.member_type AS memberType, m.class_section AS classSection, m.status,
       COUNT(l.id) AS totalLoans,
       SUM(l.id IS NOT NULL AND l.returned_at IS NULL) AS activeLoans,
       SUM(l.id IS NOT NULL AND l.returned_at IS NULL AND l.due_date < CURRENT_DATE()) AS overdueLoans
     FROM members m LEFT JOIN loans l ON l.member_id = m.id
     ${where}
     GROUP BY m.id, m.name, m.membership_number, m.email, m.member_type, m.class_section, m.status
     ORDER BY m.name LIMIT 20000`,
    params,
  )
  res.json(people.map((person) => ({
    ...person,
    id: Number(person.id),
    totalLoans: Number(person.totalLoans || 0),
    activeLoans: Number(person.activeLoans || 0),
    overdueLoans: Number(person.overdueLoans || 0),
  })))
}))

app.get('/api/reports/classes', ...staff, asyncRoute(async (req, res) => {
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return res.status(400).json({ error: 'Report dates must use YYYY-MM-DD.' })
  }
  if (from && to && from > to) return res.status(400).json({ error: 'The start date must not be after the end date.' })
  const classRows = schoolClasses.map(() => 'SELECT ? AS classSection').join(' UNION ALL ')
  const params = [...schoolClasses]
  const loanDateFilter = []
  if (from) {
    loanDateFilter.push('l.issued_at >= ?')
    params.push(from)
  }
  if (to) {
    loanDateFilter.push('l.issued_at < DATE_ADD(?, INTERVAL 1 DAY)')
    params.push(to)
  }
  const [classes] = await pool.execute(
    `SELECT c.classSection, COUNT(DISTINCT m.id) AS students,
       COUNT(l.id) AS totalLoans,
       SUM(l.id IS NOT NULL AND l.returned_at IS NULL) AS activeLoans,
       SUM(l.id IS NOT NULL AND l.returned_at IS NULL AND l.due_date < CURRENT_DATE()) AS overdueLoans
     FROM (${classRows}) c
     LEFT JOIN members m ON m.class_section = c.classSection AND m.member_type = 'Student'
     LEFT JOIN loans l ON l.member_id = m.id${loanDateFilter.length ? ` AND ${loanDateFilter.join(' AND ')}` : ''}
     GROUP BY c.classSection
     ORDER BY c.classSection`,
    params,
  )
  res.json(classes.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' || typeof value === 'number' ? Number(value) : value]))))
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
  const columns = ['isbn', 'title', 'author', 'category', 'shelf', 'total_copies', 'available_copies']
  const csv = csvDocument(columns, books)
  res.type('text/csv').attachment('library-catalog.csv').send(csv)
}))

app.get('/api/export/members.csv', ...staff, asyncRoute(async (_req, res) => {
  const [members] = await pool.query(
    `SELECT membership_number, name, member_type, class_section, email, status,
       DATE_FORMAT(joined_at, '%Y-%m-%d') AS joined_at
     FROM members ORDER BY member_type, class_section, name`,
  )
  const columns = ['name', 'member_type', 'class_section', 'membership_number', 'email', 'status', 'joined_at']
  res.type('text/csv').attachment('gs-busanza-members.csv').send(csvDocument(columns, members))
}))

app.get('/api/export/reports.csv', ...staff, asyncRoute(async (req, res) => {
  const filters = reportFilters(req.query)
  if (filters.error) return res.status(400).json({ error: filters.error })
  const [rows] = await pool.execute(
    `${loanReportSelect} ${filters.where} ORDER BY l.issued_at DESC, m.name`,
    filters.params,
  )
  const columns = [
    'issuedAt', 'memberName', 'membershipNumber', 'memberType', 'classSection',
    'email', 'bookTitle', 'isbn', 'dueDate', 'returnedAt', 'status',
  ]
  res.type('text/csv').attachment('gs-busanza-library-report.csv').send(csvDocument(columns, rows))
}))

app.use((req, res) => res.status(404).json({ error: `No route for ${req.method} ${req.path}.` }))

app.use((error, _req, res, _next) => {
  if (error.code === 'MISSING_JWT_SECRET') {
    console.error(error.message)
    return res.status(503).json({ error: 'Authentication is not configured. Set JWT_SECRET in your deployment environment.' })
  }
  if (error.code === 'ER_NO_SUCH_TABLE' || error.code === 'ER_BAD_DB_ERROR') {
    console.error('Database schema is missing. Configure MySQL and run "npm run db:setup".')
    return res.status(503).json({ error: 'Database schema is missing. Check your MySQL configuration and run npm run db:setup.' })
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND' || error.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('Could not connect to MySQL. Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, and DB_SSL.')
    return res.status(503).json({ error: 'Could not connect to the library database. Check the deployment database settings.' })
  }
  console.error(error)
  return res.status(500).json({ error: 'An unexpected server error occurred.' })
})

export default app
