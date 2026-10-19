import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createHash, randomBytes } from 'node:crypto'
import { config, isSmtpConfigured, requireJwtSecret } from './config.js'
import { authenticate, allowRoles } from './auth.js'
import { pool } from './db.js'
import { csvDocument, parseCsv } from './csv.js'
import { migratePasswordResetTokens, migrateSchoolDirectory } from './migrations.js'
import { sendEmail } from './email.js'

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

function isValidIsoDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date
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

let passwordResetSchemaPromise
async function ensurePasswordResetSchema() {
  if (!passwordResetSchemaPromise) {
    passwordResetSchemaPromise = (async () => {
      const connection = await pool.getConnection()
      try {
        await migratePasswordResetTokens(connection)
      } finally {
        connection.release()
      }
    })().catch((error) => {
      passwordResetSchemaPromise = null
      throw error
    })
  }
  return passwordResetSchemaPromise
}

function validateMember(data) {
  const name = String(data.name || '').trim()
  const memberType = String(data.member_type ?? data.memberType ?? 'Student').trim()
  const classSection = String(data.class_section ?? data.classSection ?? '').trim().toUpperCase()
  const membershipNumber = String(data.membership_number ?? data.membershipNumber ?? '').trim()
  const emailValue = String(data.email || '').trim().toLowerCase()
  const email = emailValue || null
  const phoneValue = String(data.phone || '').trim()
  const phone = phoneValue || null

  if (!name || name.length > 120) return { error: 'Name is required and must be at most 120 characters.' }
  if (!['Student', 'Teacher'].includes(memberType)) return { error: 'Member type must be Student or Teacher.' }
  if (email && (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { error: 'Email must be a valid address or left blank.' }
  }
  if (phone && (phone.length > 32 || !/^\+?[0-9 ()-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7)) {
    return { error: 'Phone number must have at least 7 digits and use only numbers, spaces, +, parentheses, or hyphens.' }
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
      phone,
    },
  }
}

function validateMemberPhoto(body, creating = false) {
  const action = body.photoAction || (body.photoData ? 'replace' : 'keep')
  if (!['keep', 'replace', 'remove'].includes(action)) {
    return { error: 'Choose a valid photo action.' }
  }
  if (creating && action === 'remove') {
    return { error: 'A new member does not have a photo to remove.' }
  }
  if (action !== 'replace') return { value: { action, mimeType: null, data: null } }

  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(body.photoData || ''))
  if (!match) {
    return { error: 'Upload a valid JPEG passport photo.' }
  }
  const data = Buffer.from(match[1], 'base64')
  if (data.length < 4 || data.length > 512 * 1024 || data.toString('base64') !== match[1]
    || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
    return { error: 'Photo must be a valid JPEG no larger than 512 KB.' }
  }
  return { value: { action, mimeType: 'image/jpeg', data } }
}

function reportFilters(query, includeStatus = true, dateColumn = 'l.issued_at') {
  const conditions = []
  const params = []
  const from = String(query.from || '')
  const to = String(query.to || '')
  if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to))) {
    return { error: 'Report dates must use YYYY-MM-DD.' }
  }
  if (from && to && from > to) return { error: 'The start date must not be after the end date.' }
  if (from) {
    conditions.push(`${dateColumn} >= ?`)
    params.push(from)
  }
  if (to) {
    conditions.push(`${dateColumn} < DATE_ADD(?, INTERVAL 1 DAY)`)
    params.push(to)
  }

  const search = String(query.search || '').trim()
  if (search) {
    conditions.push('(m.name LIKE ? OR m.membership_number LIKE ? OR b.title LIKE ? OR b.isbn LIKE ? OR l.copy_code LIKE ?)')
    const term = `%${search}%`
    params.push(term, term, term, term, term)
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
    if (query.status === 'Active') conditions.push('(l.quantity > l.returned_quantity + l.missed_quantity) AND l.due_date >= CURRENT_DATE()')
    else if (query.status === 'Overdue') conditions.push('(l.quantity > l.returned_quantity + l.missed_quantity) AND l.due_date < CURRENT_DATE()')
    else if (query.status === 'Returned') conditions.push('l.returned_at IS NOT NULL AND l.missed_quantity = 0')
    else if (query.status === 'Missed') conditions.push('l.missed_quantity > 0')
    else if (query.status && query.status !== 'All') return { error: 'Choose a valid report status.' }
  }
  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params }
}

const loanReportSelect = `SELECT l.id, b.title AS bookTitle, b.isbn, b.grade,
  m.id AS memberId, m.name AS memberName, m.membership_number AS membershipNumber,
  m.member_type AS memberType, m.class_section AS classSection, m.email, l.copy_code AS copyCode,
  DATE_FORMAT(l.issued_at, '%Y-%m-%d') AS issuedAt,
  DATE_FORMAT(l.due_date, '%Y-%m-%d') AS dueDate,
  DATE_FORMAT(l.returned_at, '%Y-%m-%d') AS returnedAt,
  DATE_FORMAT(l.missed_at, '%Y-%m-%d') AS missedAt,
  l.quantity, l.returned_quantity AS returnedQuantity,
  l.missed_quantity AS missedQuantity,
  (l.quantity - l.returned_quantity - l.missed_quantity) AS outstandingQuantity,
  CASE WHEN l.quantity > l.returned_quantity + l.missed_quantity AND l.due_date < CURRENT_DATE() THEN 'Overdue'
       WHEN l.quantity > l.returned_quantity + l.missed_quantity THEN 'Active'
       WHEN l.missed_quantity > 0 THEN 'Missed'
       ELSE 'Returned' END AS status
  FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id`

function validateBook(body) {
  const isbnValue = String(body.isbn || '').trim()
  const isbn = isbnValue || null
  const title = String(body.title || '').trim()
  const author = String(body.author || '').trim()
  const publisherValue = String(body.publisher || '').trim()
  const publisher = publisherValue || null
  const category = String(body.category || 'General').trim()
  const gradeValue = String(body.grade || '').trim()
  const grade = gradeValue || null
  const bookType = String(body.bookType ?? body.book_type ?? 'General').trim() || 'General'
  const shelf = String(body.shelfLocation ?? body.shelf ?? '').trim() || 'Unassigned'
  const totalCopies = Number(body.totalCopies ?? body.copies)
  const deliveredOnValue = String(body.deliveredOn ?? body.dateDelivered ?? '').trim()
  const deliveredOn = deliveredOnValue || null
  const publicationYearValue = String(body.publicationYear ?? body.publishedYear ?? '').trim()
  const publicationYear = publicationYearValue ? Number(publicationYearValue) : null

  if (!title || title.length > 255 || (isbn && isbn.length > 32) || (author && author.length > 180)
    || (publisher && publisher.length > 180) || (grade && grade.length > 40) || bookType.length > 80 || shelf.length > 40
    || !Number.isInteger(totalCopies) || totalCopies < 1 || totalCopies > 10000
    || (publicationYear !== null && (!Number.isInteger(publicationYear) || publicationYear < 1 || publicationYear > 9999))) {
    return { error: 'A title, valid optional book details, and a copy count between 1 and 10,000 are required.' }
  }
  for (const [label, date] of [['Delivery date', deliveredOn]]) {
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) {
      return { error: `${label} must be a valid date in YYYY-MM-DD format.` }
    }
  }

  return { value: { isbn, title, author: author || null, publisher, category, grade: grade || '', bookType, shelf, totalCopies, deliveredOn, publicationYear } }
}

function bookIdentityKey(book) {
  return [book.isbn, book.title, book.grade, book.bookType]
    .map((value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase())
    .join('\u0000')
}

async function findDuplicateBook(connection, book, excludeId = null) {
  if (!book.isbn) return null
  const [rows] = await connection.execute(
    `SELECT id FROM books
     WHERE LOWER(TRIM(isbn)) = LOWER(TRIM(?))
       AND LOWER(TRIM(title)) = LOWER(TRIM(?))
       AND LOWER(TRIM(COALESCE(grade, ''))) = LOWER(TRIM(?))
       AND LOWER(TRIM(COALESCE(book_type, 'General'))) = LOWER(TRIM(?))
       AND (? IS NULL OR id <> ?)
     LIMIT 1`,
    [book.isbn, book.title, book.grade, book.bookType, excludeId, excludeId],
  )
  return rows[0] || null
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

app.post('/api/auth/password-reset/request', asyncRoute(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase()
  if (!username || username.length > 190) {
    return res.status(400).json({ error: 'Enter your librarian username.' })
  }
  if (!config.passwordResetEmail || !config.publicAppUrl || !isSmtpConfigured()) {
    return res.status(503).json({ error: 'Password reset email is not configured. Contact the library administrator.' })
  }
  await ensurePasswordResetSchema()

  const connection = await pool.getConnection()
  let account
  let token
  try {
    await connection.beginTransaction()
    const [[user]] = await connection.execute(
      `SELECT id, name FROM users WHERE email = ? AND role = 'Librarian' LIMIT 1 FOR UPDATE`,
      [username],
    )
    if (!user) {
      await connection.commit()
      return res.json({ message: 'If the librarian account matches, a reset link will be sent to the configured mailbox.' })
    }
    account = user
    const [[previousRequest]] = await connection.execute(
      `SELECT send_count AS sendCount, DATE_FORMAT(send_date, '%Y-%m-%d') AS sendDate,
         last_sent_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 60 SECOND) AS coolingDown
       FROM password_reset_tokens WHERE user_id = ? FOR UPDATE`,
      [user.id],
    )
    if (Number(previousRequest?.coolingDown)) {
      await connection.rollback()
      return res.json({ message: 'If the librarian account matches, a reset link will be sent to the configured mailbox.' })
    }
    const [[todayRow]] = await connection.query("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS today")
    const sendCount = previousRequest?.sendDate === todayRow.today ? Number(previousRequest.sendCount) : 0
    if (sendCount >= 5) {
      await connection.rollback()
      return res.json({ message: 'If the librarian account matches, a reset link will be sent to the configured mailbox.' })
    }

    token = randomBytes(32).toString('hex')
    await connection.execute(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, last_sent_at, send_date, send_count)
       VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 MINUTE), CURRENT_TIMESTAMP, CURRENT_DATE, ?)
       ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at),
         last_sent_at = VALUES(last_sent_at), send_date = VALUES(send_date), send_count = VALUES(send_count)`,
      [user.id, createHash('sha256').update(token).digest('hex'), sendCount + 1],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }

  const resetUrl = new URL(config.publicAppUrl)
  resetUrl.searchParams.set('resetToken', token)
  try {
    await sendEmail({
      to: config.passwordResetEmail,
      name: account.name,
      subject: 'Reset your GS Busanza Library password',
      text: `Hello ${account.name},\n\nUse this one-time link to reset your librarian password within 30 minutes:\n${resetUrl}\n\nIf you did not request this, ignore this email. Your password will not change.`,
    })
  } catch (error) {
    console.error(`Could not send the librarian password reset email: ${error.message}`)
    return res.status(502).json({ error: 'Could not send the reset email. Check the email settings and try again.' })
  }
  res.json({ message: 'If the librarian account matches, a reset link will be sent to the configured mailbox.' })
}))

app.post('/api/auth/password-reset/complete', asyncRoute(async (req, res) => {
  const token = String(req.body?.token || '')
  const password = String(req.body?.password || '')
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).json({ error: 'This password reset link is invalid or has expired. Request a new link.' })
  }
  if (Buffer.byteLength(password, 'utf8') < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Choose a password between 12 and 72 bytes.' })
  }
  await ensurePasswordResetSchema()

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[record]] = await connection.execute(
      `SELECT t.user_id AS userId, t.expires_at <= CURRENT_TIMESTAMP AS expired, u.name
       FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? FOR UPDATE`,
      [createHash('sha256').update(token).digest('hex')],
    )
    if (!record || Number(record.expired)) {
      if (record) await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [record.userId])
      await connection.commit()
      return res.status(400).json({ error: 'This password reset link is invalid or has expired. Request a new link.' })
    }

    const passwordHash = await bcrypt.hash(password, 12)
    await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, record.userId])
    await connection.execute('DELETE FROM password_reset_tokens WHERE user_id = ?', [record.userId])
    await audit(connection, record.name, 'Librarian password reset', 'Librarian password changed using a one-time email reset link')
    await connection.commit()
    res.json({ message: 'Your password has been reset. Sign in with your new password.' })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}))

app.get('/api/auth/me', ...staff, (_req, res) => res.json({ user: _req.user }))

app.post('/api/admin/migrations/school-directory', ...canManage, asyncRoute(async (req, res) => {
  const connection = await pool.getConnection()
  try {
    await migrateSchoolDirectory(connection)
    await audit(connection, req.user.name, 'School directory migration applied', 'Updated student, teacher, book, and loan records, added staff-only member photo storage, and created the password reset token table')
    res.json({ message: 'The school directory and password reset database migrations are complete.' })
  } finally {
    connection.release()
  }
}))

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
      (SELECT COALESCE(SUM(quantity - returned_quantity - missed_quantity), 0) FROM loans WHERE quantity > returned_quantity + missed_quantity) AS activeLoans,
      (SELECT COALESCE(SUM(quantity - returned_quantity - missed_quantity), 0) FROM loans WHERE quantity > returned_quantity + missed_quantity AND due_date < CURRENT_DATE()) AS overdueLoans,
      (SELECT COUNT(*) FROM members WHERE status = 'Active') AS activeMembers`,
  )
  const [monthlyRows] = await pool.query(
    `SELECT DATE_FORMAT(issued_at, '%Y-%m') AS monthKey, COALESCE(SUM(quantity), 0) AS total
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
    `SELECT id, isbn, title, author, publisher, category, grade, book_type AS bookType, shelf,
       total_copies AS totalCopies, available_copies AS availableCopies,
       DATE_FORMAT(delivered_on, '%Y-%m-%d') AS deliveredOn,
       published_year AS publicationYear
     FROM books
     WHERE title LIKE ? OR author LIKE ? OR publisher LIKE ? OR isbn LIKE ? OR category LIKE ? OR grade LIKE ? OR book_type LIKE ? OR shelf LIKE ?
     ORDER BY title`,
    [search, search, search, search, search, search, search, search],
  )
  res.json(books.map((book) => ({ ...book, id: Number(book.id) })))
}))

app.post('/api/books/import', ...canManage, asyncRoute(async (req, res) => {
  if (typeof req.body !== 'string' || !req.body.trim()) {
    return res.status(400).json({ error: 'Upload a non-empty CSV file.' })
  }
  let rows
  try {
    rows = parseCsv(req.body.replace(/^\uFEFF/, ''))
  } catch (error) {
    return res.status(400).json({ error: error.message })
  }
  if (rows.length < 2) return res.status(400).json({ error: 'The CSV needs a header row and at least one book row.' })
  if (rows.length > 5001) return res.status(413).json({ error: 'Import up to 5,000 books per CSV file.' })

  const headers = rows[0].map((header) => header.trim().toLowerCase())
  if (!headers.includes('title') || (!headers.includes('total_copies') && !headers.includes('copies'))) {
    return res.status(400).json({ error: 'CSV headers must include: title, total_copies. Other book details are optional.' })
  }
  const imported = []
  const skipped = []
  const invalid = []
  const seenBookIdentities = new Set()
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    for (let index = 1; index < rows.length; index += 1) {
      const csvRow = rows[index]
      const row = Object.fromEntries(headers.map((header, column) => [header, csvRow[column] || '']))
      const { value, error } = validateBook({
        ...row,
        totalCopies: row.total_copies || row.copies,
        deliveredOn: row.date_delivered || row.delivered_on,
        publicationYear: row.publication_year || (row.date_of_publication ? String(row.date_of_publication).slice(0, 4) : ''),
        shelfLocation: row.shelf_location || row.shelf,
        bookType: row.book_type || row.booktype || row.type,
      })
      const line = index + 1
      if (error) {
        invalid.push({ line, reason: error })
        continue
      }
      if (value.isbn) {
        const identity = bookIdentityKey(value)
        if (seenBookIdentities.has(identity)) {
          skipped.push({ line, reason: 'The physical code, title, grade, and book type are duplicated in this file.' })
          continue
        }
        seenBookIdentities.add(identity)
        const duplicate = await findDuplicateBook(connection, value)
        if (duplicate) {
          skipped.push({ line, reason: 'The physical code is already used by this title, grade, and book type.' })
          continue
        }
      }
      await connection.execute(
        `INSERT INTO books
         (isbn, title, author, publisher, category, grade, book_type, shelf, total_copies, available_copies, delivered_on, published_year)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [value.isbn, value.title, value.author, value.publisher, value.category, value.grade, value.bookType, value.shelf, value.totalCopies, value.totalCopies, value.deliveredOn, value.publicationYear],
      )
      imported.push({ line, title: value.title })
    }
    await audit(connection, req.user.name, 'Books imported', `Imported ${imported.length} book title(s)`)
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A book was added by another import while this file was processing. Please upload the file again.' })
    }
    throw error
  } finally {
    connection.release()
  }
  res.json({ imported: imported.length, skipped, invalid })
}))

app.post('/api/books', ...canManage, asyncRoute(async (req, res) => {
  const { value, error } = validateBook(req.body)
  if (error) return res.status(400).json({ error })

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    if (await findDuplicateBook(connection, value)) {
      await connection.rollback()
      return res.status(409).json({ error: 'That physical code is already used by the same title, grade, and book type.' })
    }
    const [result] = await connection.execute(
      `INSERT INTO books
       (isbn, title, author, publisher, category, grade, book_type, shelf, total_copies, available_copies, delivered_on, published_year)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.isbn, value.title, value.author, value.publisher, value.category, value.grade, value.bookType, value.shelf, value.totalCopies, value.totalCopies, value.deliveredOn, value.publicationYear],
    )
    await audit(connection, req.user.name, 'Book added', `Added "${value.title}" to the catalog`)
    await connection.commit()
    res.status(201).json({ id: result.insertId, ...value, availableCopies: value.totalCopies })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That physical code is already used by the same title, grade, and book type.' })
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
       (SELECT COALESCE(SUM(quantity - returned_quantity - missed_quantity), 0) FROM loans WHERE book_id = b.id AND quantity > returned_quantity + missed_quantity) AS borrowed
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
    if (await findDuplicateBook(connection, value, Number(req.params.id))) {
      await connection.rollback()
      return res.status(409).json({ error: 'That physical code is already used by the same title, grade, and book type.' })
    }
    const availableCopies = value.totalCopies - borrowed
    await connection.execute(
      `UPDATE books SET isbn = ?, title = ?, author = ?, publisher = ?, category = ?, grade = ?, book_type = ?, shelf = ?,
       total_copies = ?, available_copies = ?, delivered_on = ?, published_year = ? WHERE id = ?`,
      [value.isbn, value.title, value.author, value.publisher, value.category, value.grade, value.bookType, value.shelf, value.totalCopies, availableCopies, value.deliveredOn, value.publicationYear, req.params.id],
    )
    await audit(connection, req.user.name, 'Book updated', `Updated "${value.title}" in the catalog`)
    await connection.commit()
    res.json({ id: Number(req.params.id), ...value, availableCopies })
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That physical code is already used by the same title, grade, and book type.' })
    throw error
  } finally {
    connection.release()
  }
}))

app.delete('/api/books/:id', ...canManage, asyncRoute(async (req, res) => {
  const bookId = Number(req.params.id)
  if (!Number.isSafeInteger(bookId) || bookId < 1) {
    return res.status(400).json({ error: 'Book ID must be a positive integer.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[book]] = await connection.execute('SELECT title FROM books WHERE id = ? FOR UPDATE', [bookId])
    if (!book) {
      await connection.rollback()
      return res.status(404).json({ error: 'Book not found.' })
    }
    await connection.execute('DELETE FROM books WHERE id = ?', [bookId])
    await audit(connection, req.user.name, 'Book removed', `Removed "${book.title}" from the catalog`)
    await connection.commit()
    res.status(204).end()
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ error: 'This book has loan history and cannot be removed.' })
    }
    throw error
  } finally {
    connection.release()
  }
}))

app.get('/api/members', ...staff, asyncRoute(async (req, res) => {
  const search = `%${String(req.query.search || '').trim()}%`
  const [members] = await pool.execute(
    `SELECT m.id, m.membership_number AS membershipNumber, m.name, m.email, m.phone,
       m.member_type AS memberType, m.class_section AS classSection, m.status,
       (m.photo_data IS NOT NULL) AS hasPhoto,
       DATE_FORMAT(m.joined_at, '%Y-%m-%d') AS joinedAt,
       (SELECT COALESCE(SUM(l.quantity - l.returned_quantity - l.missed_quantity), 0) FROM loans l WHERE l.member_id = m.id AND l.quantity > l.returned_quantity + l.missed_quantity) AS activeLoans,
       (SELECT COALESCE(SUM(l.quantity), 0) FROM loans l WHERE l.member_id = m.id) AS totalLoans
     FROM members m
     WHERE m.name LIKE ? OR m.email LIKE ? OR m.phone LIKE ? OR m.membership_number LIKE ? OR m.class_section LIKE ?
     ORDER BY name`,
    [search, search, search, search, search],
  )
  res.json(members.map((member) => ({
    ...member,
    id: Number(member.id),
    hasPhoto: Boolean(Number(member.hasPhoto)),
    activeLoans: Number(member.activeLoans),
    totalLoans: Number(member.totalLoans),
  })))
}))

app.get('/api/members/:id/photo', ...staff, asyncRoute(async (req, res) => {
  const memberId = Number(req.params.id)
  if (!Number.isSafeInteger(memberId) || memberId < 1) {
    return res.status(400).json({ error: 'Member ID must be a positive integer.' })
  }
  const [[member]] = await pool.execute(
    'SELECT photo_mime_type AS mimeType, photo_data AS photoData FROM members WHERE id = ?',
    [memberId],
  )
  if (!member) return res.status(404).json({ error: 'Member not found.' })
  if (!member.photoData || member.mimeType !== 'image/jpeg') {
    return res.status(404).json({ error: 'This member has no photo.' })
  }
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.type(member.mimeType).send(member.photoData)
}))

app.post('/api/members', ...canManage, asyncRoute(async (req, res) => {
  const { value, error } = validateMember(req.body)
  if (error) return res.status(400).json({ error })
  const { value: photo, error: photoError } = validateMemberPhoto(req.body, true)
  if (photoError) return res.status(400).json({ error: photoError })

  try {
    const [result] = await pool.execute(
      `INSERT INTO members (membership_number, name, email, phone, member_type, class_section, photo_mime_type, photo_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [value.membershipNumber, value.name, value.email, value.phone, value.memberType, value.classSection, photo.mimeType, photo.data],
    )
    await audit(
      pool,
      req.user.name,
      'Member added',
      `Registered ${value.name} as a ${value.memberType.toLowerCase()}${photo.action === 'replace' ? ' with a passport photo' : ''}`,
    )
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

app.put('/api/members/:id', ...canManage, asyncRoute(async (req, res) => {
  const memberId = Number(req.params.id)
  if (!Number.isSafeInteger(memberId) || memberId < 1) {
    return res.status(400).json({ error: 'Member ID must be a positive integer.' })
  }
  const { value, error } = validateMember(req.body)
  if (error) return res.status(400).json({ error })
  const { value: photo, error: photoError } = validateMemberPhoto(req.body)
  if (photoError) return res.status(400).json({ error: photoError })

  try {
    const photoUpdate = photo.action === 'replace'
      ? ', photo_mime_type = ?, photo_data = ?'
      : photo.action === 'remove'
        ? ', photo_mime_type = NULL, photo_data = NULL'
        : ''
    const photoParameters = photo.action === 'replace' ? [photo.mimeType, photo.data] : []
    const [result] = await pool.execute(
      `UPDATE members
       SET membership_number = ?, name = ?, email = ?, phone = ?, member_type = ?, class_section = ?${photoUpdate}
       WHERE id = ?`,
      [value.membershipNumber, value.name, value.email, value.phone, value.memberType, value.classSection, ...photoParameters, memberId],
    )
    if (!result.affectedRows) {
      const [[existing]] = await pool.execute('SELECT id FROM members WHERE id = ?', [memberId])
      if (!existing) return res.status(404).json({ error: 'Member not found.' })
    }
    const photoAudit = photo.action === 'replace' ? '; passport photo updated' : photo.action === 'remove' ? '; passport photo removed' : ''
    await audit(pool, req.user.name, 'Member updated', `Updated details for ${value.name} (${value.membershipNumber})${photoAudit}`)
    res.json({ id: memberId, ...value })
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
  const seenIdentities = new Set()
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
      const identityKey = [value.memberType, value.classSection || '', value.name.trim().toLocaleLowerCase()].join('|')
      if (seenNumbers.has(value.membershipNumber) || (value.email && seenEmails.has(value.email)) || seenIdentities.has(identityKey)) {
        skipped.push({ line, reason: 'This member is duplicated in the CSV by membership number, email, or name and class.' })
        continue
      }
      const [[duplicate]] = await connection.execute(
        `SELECT membership_number FROM members
         WHERE membership_number = ?
            OR (? IS NOT NULL AND email = ?)
            OR (LOWER(TRIM(name)) = LOWER(?) AND member_type = ? AND COALESCE(class_section, '') = ?)
         LIMIT 1`,
        [value.membershipNumber, value.email, value.email, value.name, value.memberType, value.classSection || ''],
      )
      if (duplicate) {
        skipped.push({ line, reason: 'This member already exists by membership number, email, or name and class.' })
        continue
      }
      await connection.execute(
        `INSERT INTO members (membership_number, name, email, phone, member_type, class_section)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [value.membershipNumber, value.name, value.email, value.phone, value.memberType, value.classSection],
      )
      seenNumbers.add(value.membershipNumber)
      if (value.email) seenEmails.add(value.email)
      seenIdentities.add(identityKey)
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

app.delete('/api/members/:id', ...canManage, asyncRoute(async (req, res) => {
  const memberId = Number(req.params.id)
  if (!Number.isSafeInteger(memberId) || memberId < 1) {
    return res.status(400).json({ error: 'Member ID must be a positive integer.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[member]] = await connection.execute('SELECT name, membership_number FROM members WHERE id = ? FOR UPDATE', [memberId])
    if (!member) {
      await connection.rollback()
      return res.status(404).json({ error: 'Member not found.' })
    }
    await connection.execute('DELETE FROM members WHERE id = ?', [memberId])
    await audit(connection, req.user.name, 'Member removed', `Removed ${member.name} (${member.membership_number})`)
    await connection.commit()
    res.status(204).end()
  } catch (error) {
    await connection.rollback()
    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ error: 'This member has loan or library attendance history and cannot be deleted.' })
    }
    throw error
  } finally {
    connection.release()
  }
}))

app.get('/api/loans', ...staff, asyncRoute(async (req, res) => {
  const filter = req.query.status
  const overdueOnly = filter === 'Overdue'
  const activeOnly = filter === 'Active'
  const missedOnly = filter === 'Missed'
  const returnedOnly = filter === 'Returned'
  const where = overdueOnly
    ? 'WHERE l.quantity > l.returned_quantity + l.missed_quantity AND l.due_date < CURRENT_DATE()'
    : activeOnly
      ? 'WHERE l.quantity > l.returned_quantity + l.missed_quantity AND l.due_date >= CURRENT_DATE()'
      : missedOnly ? 'WHERE l.missed_quantity > 0'
        : returnedOnly ? 'WHERE l.quantity = l.returned_quantity AND l.missed_quantity = 0' : ''
  const [loans] = await pool.query(
    `SELECT l.id, b.id AS bookId, b.title AS bookTitle, b.isbn, b.grade, l.copy_code AS copyCode,
       m.id AS memberId, m.name AS memberName, m.membership_number AS membershipNumber,
       m.member_type AS memberType, m.class_section AS classSection,
       DATE_FORMAT(l.issued_at, '%Y-%m-%d') AS issuedAt,
       DATE_FORMAT(l.due_date, '%Y-%m-%d') AS dueDate,
       DATE_FORMAT(l.returned_at, '%Y-%m-%d') AS returnedAt,
       DATE_FORMAT(l.missed_at, '%Y-%m-%d') AS missedAt,
       l.quantity, l.returned_quantity AS returnedQuantity,
       l.missed_quantity AS missedQuantity,
       (l.quantity - l.returned_quantity - l.missed_quantity) AS outstandingQuantity,
       CASE WHEN l.quantity > l.returned_quantity + l.missed_quantity AND l.due_date < CURRENT_DATE() THEN 'Overdue'
            WHEN l.quantity > l.returned_quantity + l.missed_quantity THEN 'Active'
            WHEN l.missed_quantity > 0 THEN 'Missed'
            ELSE 'Returned' END AS status
     FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id
     ${where} ORDER BY l.issued_at DESC`,
  )
  res.json(loans.map((loan) => ({ ...loan, id: Number(loan.id), bookId: Number(loan.bookId), memberId: Number(loan.memberId) })))
}))

app.get('/api/reports', ...staff, asyncRoute(async (req, res) => {
  const dateColumn = req.query.status === 'Returned'
    ? 'l.returned_at'
    : req.query.status === 'Missed' ? 'l.missed_at' : 'l.issued_at'
  const filters = reportFilters(req.query, true, dateColumn)
  if (filters.error) return res.status(400).json({ error: filters.error })
  const summaryFilters = reportFilters(req.query, false, dateColumn)
  if (summaryFilters.error) return res.status(400).json({ error: summaryFilters.error })
  const [rows] = await pool.execute(
    `${loanReportSelect} ${filters.where} ORDER BY l.issued_at DESC, m.name LIMIT 20000`,
    filters.params,
  )
  const [[summary]] = await pool.execute(
    `SELECT COALESCE(SUM(l.quantity), 0) AS totalLoans,
      COALESCE(SUM(l.quantity - l.returned_quantity - l.missed_quantity), 0) AS activeLoans,
      COALESCE(SUM((l.quantity - l.returned_quantity - l.missed_quantity) * (l.due_date < CURRENT_DATE())), 0) AS overdueLoans,
      COALESCE(SUM(l.returned_quantity), 0) AS returnedLoans,
      COALESCE(SUM(l.missed_quantity), 0) AS missedLoans,
      COALESCE(SUM(l.quantity * (m.member_type = 'Student')), 0) AS studentLoans,
      COALESCE(SUM(l.quantity * (m.member_type = 'Teacher')), 0) AS teacherLoans
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
    conditions.push('(m.name LIKE ? OR m.membership_number LIKE ? OR m.email LIKE ? OR m.phone LIKE ?)')
    params.push(search, search, search, search)
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
    `SELECT m.id, m.name, m.membership_number AS membershipNumber, m.email, m.phone,
       m.member_type AS memberType, m.class_section AS classSection, m.status,
       COALESCE(SUM(l.quantity), 0) AS totalLoans,
       COALESCE(SUM(l.quantity - l.returned_quantity - l.missed_quantity), 0) AS activeLoans,
       COALESCE(SUM((l.quantity - l.returned_quantity - l.missed_quantity) * (l.due_date < CURRENT_DATE())), 0) AS overdueLoans
     FROM members m LEFT JOIN loans l ON l.member_id = m.id
     ${where}
     GROUP BY m.id, m.name, m.membership_number, m.email, m.phone, m.member_type, m.class_section, m.status
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
       COALESCE(SUM(l.quantity), 0) AS totalLoans,
       COALESCE(SUM(l.quantity - l.returned_quantity - l.missed_quantity), 0) AS activeLoans,
       COALESCE(SUM((l.quantity - l.returned_quantity - l.missed_quantity) * (l.due_date < CURRENT_DATE())), 0) AS overdueLoans
     FROM (${classRows}) c
     LEFT JOIN members m ON m.class_section = c.classSection AND m.member_type = 'Student'
     LEFT JOIN loans l ON l.member_id = m.id${loanDateFilter.length ? ` AND ${loanDateFilter.join(' AND ')}` : ''}
     GROUP BY c.classSection
     ORDER BY c.classSection`,
    params,
  )
  res.json(classes.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' || typeof value === 'number' ? Number(value) : value]))))
}))

app.get('/api/reports/non-borrowers', ...staff, asyncRoute(async (req, res) => {
  const conditions = ['NOT EXISTS (SELECT 1 FROM loans l WHERE l.member_id = m.id)']
  const params = []
  const search = String(req.query.search || '').trim()
  if (search) {
    const term = `%${search}%`
    conditions.push('(m.name LIKE ? OR m.membership_number LIKE ? OR m.email LIKE ? OR m.phone LIKE ?)')
    params.push(term, term, term, term)
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
  const [people] = await pool.execute(
    `SELECT m.id, m.name, m.membership_number AS membershipNumber, m.email, m.phone,
       m.member_type AS memberType, m.class_section AS classSection, m.status,
       DATE_FORMAT(m.joined_at, '%Y-%m-%d') AS joinedAt
     FROM members m WHERE ${conditions.join(' AND ')}
     ORDER BY m.member_type, m.class_section, m.name LIMIT 20000`,
    params,
  )
  res.json(people.map((person) => ({ ...person, id: Number(person.id) })))
}))

app.get('/api/reports/popular-books', ...staff, asyncRoute(async (req, res) => {
  const filters = reportFilters(req.query, false)
  if (filters.error) return res.status(400).json({ error: filters.error })
  const [books] = await pool.execute(
    `SELECT b.id, b.isbn, b.title, b.author, b.publisher, b.category, b.grade, b.book_type AS bookType, b.shelf,
       COALESCE(SUM(l.quantity), 0) AS totalLoans, COUNT(DISTINCT l.member_id) AS uniqueBorrowers
     FROM loans l JOIN books b ON b.id = l.book_id JOIN members m ON m.id = l.member_id
     ${filters.where}
     GROUP BY b.id, b.isbn, b.title, b.author, b.publisher, b.category, b.grade, b.book_type, b.shelf
     ORDER BY totalLoans DESC, b.title LIMIT 20000`,
    filters.params,
  )
  res.json(books.map((book) => ({
    ...book,
    id: Number(book.id),
    totalLoans: Number(book.totalLoans),
    uniqueBorrowers: Number(book.uniqueBorrowers),
  })))
}))

app.get('/api/export/people.csv', ...staff, asyncRoute(async (req, res) => {
  const conditions = []
  const params = []
  const search = String(req.query.search || '').trim()
  if (search) {
    conditions.push('(m.name LIKE ? OR m.membership_number LIKE ? OR m.email LIKE ? OR m.phone LIKE ?)')
    const term = `%${search}%`
    params.push(term, term, term, term)
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
    `SELECT m.name, m.membership_number AS membershipNumber, m.member_type AS memberType,
       m.class_section AS classSection, m.email, m.phone, m.status,
       COALESCE(SUM(l.quantity), 0) AS totalLoans,
       COALESCE(SUM(l.quantity - l.returned_quantity - l.missed_quantity), 0) AS activeLoans,
       COALESCE(SUM((l.quantity - l.returned_quantity - l.missed_quantity) * (l.due_date < CURRENT_DATE())), 0) AS overdueLoans
     FROM members m LEFT JOIN loans l ON l.member_id = m.id
     ${where}
     GROUP BY m.id, m.name, m.membership_number, m.member_type, m.class_section, m.email, m.phone, m.status
     ORDER BY m.name LIMIT 20000`,
    params,
  )
  const columns = ['name', 'membershipNumber', 'memberType', 'classSection', 'email', 'phone', 'status', 'totalLoans', 'activeLoans', 'overdueLoans']
  res.type('text/csv').attachment('gs-busanza-borrowers.csv').send(csvDocument(columns, people))
}))

app.get('/api/export/classes.csv', ...staff, asyncRoute(async (req, res) => {
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
       COALESCE(SUM(l.quantity), 0) AS totalLoans,
       COALESCE(SUM(l.quantity - l.returned_quantity - l.missed_quantity), 0) AS activeLoans,
       COALESCE(SUM((l.quantity - l.returned_quantity - l.missed_quantity) * (l.due_date < CURRENT_DATE())), 0) AS overdueLoans
     FROM (${classRows}) c
     LEFT JOIN members m ON m.class_section = c.classSection AND m.member_type = 'Student'
     LEFT JOIN loans l ON l.member_id = m.id${loanDateFilter.length ? ` AND ${loanDateFilter.join(' AND ')}` : ''}
     GROUP BY c.classSection ORDER BY c.classSection`,
    params,
  )
  const columns = ['classSection', 'students', 'totalLoans', 'activeLoans', 'overdueLoans']
  res.type('text/csv').attachment('gs-busanza-class-report.csv').send(csvDocument(columns, classes))
}))

app.post('/api/loans', ...canManage, asyncRoute(async (req, res) => {
  const bookId = Number(req.body.bookId)
  const memberId = Number(req.body.memberId)
  const quantity = Number(req.body.quantity ?? 1)
  const checkoutDate = String(req.body.checkoutDate || formatLocalDate(new Date()))
  const dueDate = String(req.body.dueDate || '')
  if (!Number.isSafeInteger(bookId) || bookId < 1 || !Number.isSafeInteger(memberId) || memberId < 1
    || !Number.isInteger(quantity) || quantity < 1 || quantity > 300
    || !isValidIsoDate(checkoutDate) || checkoutDate > formatLocalDate(new Date())
    || !isValidIsoDate(dueDate) || dueDate < checkoutDate) {
    return res.status(400).json({ error: 'Choose a book, a member, a quantity from 1 to 300, a valid checkout date, and a due date on or after checkout.' })
  }

  const connection = await pool.getConnection()
  let connectionReleased = false
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
    if (book.available_copies < quantity) {
      await connection.rollback()
      return res.status(409).json({ error: `Only ${book.available_copies} ${Number(book.available_copies) === 1 ? 'copy is' : 'copies are'} available.` })
    }
    const [[member]] = await connection.execute(
      'SELECT id, name, email, member_type AS memberType FROM members WHERE id = ? AND status = ? FOR UPDATE',
      [memberId, 'Active'],
    )
    if (!member) {
      await connection.rollback()
      return res.status(404).json({ error: 'Active member not found.' })
    }
    if (member.memberType === 'Student' && quantity !== 1) {
      await connection.rollback()
      return res.status(400).json({ error: 'Students may check out only one book at a time.' })
    }
    const maximumActiveLoans = member.memberType === 'Teacher' ? 300 : 1
    const [[loanCount]] = await connection.execute(
      'SELECT COALESCE(SUM(quantity - returned_quantity - missed_quantity), 0) AS activeLoans FROM loans WHERE member_id = ? AND quantity > returned_quantity + missed_quantity',
      [memberId],
    )
    if (Number(loanCount.activeLoans) + quantity > maximumActiveLoans) {
      await connection.rollback()
      return res.status(409).json({
        error: `${member.memberType}s may have at most ${maximumActiveLoans} active book${maximumActiveLoans === 1 ? '' : 's'} at a time; this member has ${loanCount.activeLoans} active book${Number(loanCount.activeLoans) === 1 ? '' : 's'}.`,
      })
    }

    const copyCode = String(req.body.copyCode || '').trim()
    if (copyCode.length > 64) {
      await connection.rollback()
      return res.status(400).json({ error: 'Book copy code must be 64 characters or fewer.' })
    }
    if (copyCode) {
      const [[existingCopy]] = await connection.execute(
        'SELECT id FROM loans WHERE book_id = ? AND copy_code = ? AND quantity > returned_quantity + missed_quantity LIMIT 1 FOR UPDATE',
        [bookId, copyCode],
      )
      if (existingCopy) {
        await connection.rollback()
        return res.status(409).json({ error: 'That physical book copy is already checked out.' })
      }
    }
    const [result] = await connection.execute(
      'INSERT INTO loans (book_id, member_id, issued_at, due_date, quantity, copy_code) VALUES (?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)',
      [bookId, memberId, checkoutDate === formatLocalDate(new Date()) ? null : `${checkoutDate} 12:00:00`, dueDate, quantity, copyCode || null],
    )
    await connection.execute(
      'UPDATE books SET available_copies = available_copies - ? WHERE id = ?',
      [quantity, bookId],
    )
    await audit(connection, req.user.name, 'Book checked out', `"${book.title}" checked out to ${member.name} on ${checkoutDate}`)
    await connection.commit()
    connection.release()
    connectionReleased = true
    res.status(201).json({ id: result.insertId, bookId, memberId, bookTitle: book.title, memberName: member.name, issuedAt: checkoutDate, dueDate, quantity, returnedQuantity: 0, missedQuantity: 0, outstandingQuantity: quantity, copyCode: copyCode || null, status: 'Active' })
  } catch (error) {
    if (!connectionReleased) await connection.rollback()
    throw error
  } finally {
    if (!connectionReleased) connection.release()
  }
}))

app.post('/api/loans/batch', ...canManage, asyncRoute(async (req, res) => {
  const memberId = Number(req.body.memberId)
  const checkoutDate = String(req.body.checkoutDate || formatLocalDate(new Date()))
  const dueDate = String(req.body.dueDate || '')
  const items = req.body.items
  if (!Number.isSafeInteger(memberId) || memberId < 1
    || !Array.isArray(items) || items.length < 1 || items.length > 300
    || !isValidIsoDate(checkoutDate) || checkoutDate > formatLocalDate(new Date())
    || !isValidIsoDate(dueDate) || dueDate < checkoutDate) {
    return res.status(400).json({ error: 'Choose a member, one or more books, a valid checkout date, and a due date on or after checkout.' })
  }
  const normalizedItems = []
  const bookIds = new Set()
  const copyCodes = new Set()
  let totalQuantity = 0
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: 'Each checkout line must contain a book, quantity, and optional copy code.' })
    }
    const bookId = Number(item.bookId)
    const quantity = Number(item.quantity)
    const copyCode = String(item.copyCode || '').trim()
    const copyIdentity = `${bookId}\u0000${copyCode.trim().toLowerCase()}`
    if (!Number.isSafeInteger(bookId) || bookId < 1
      || !Number.isInteger(quantity) || quantity < 1 || quantity > 300
      || copyCode.length > 64 || bookIds.has(bookId)
      || (copyCode && copyCodes.has(copyIdentity))) {
      return res.status(400).json({ error: 'Each book must be unique and have a valid quantity and copy code.' })
    }
    bookIds.add(bookId)
    if (copyCode) copyCodes.add(copyIdentity)
    totalQuantity += quantity
    normalizedItems.push({ bookId, quantity, copyCode })
  }
  if (totalQuantity > 300) {
    return res.status(400).json({ error: 'A checkout cannot contain more than 300 copies.' })
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[member]] = await connection.execute(
      'SELECT id, name, member_type AS memberType FROM members WHERE id = ? AND status = ? FOR UPDATE',
      [memberId, 'Active'],
    )
    if (!member) {
      await connection.rollback()
      return res.status(404).json({ error: 'Active member not found.' })
    }
    if (member.memberType === 'Student' && (normalizedItems.length !== 1 || totalQuantity !== 1)) {
      await connection.rollback()
      return res.status(400).json({ error: 'Students may check out only one book at a time.' })
    }

    const [[loanCount]] = await connection.execute(
      'SELECT COALESCE(SUM(quantity - returned_quantity - missed_quantity), 0) AS activeLoans FROM loans WHERE member_id = ? AND quantity > returned_quantity + missed_quantity',
      [memberId],
    )
    const maximumActiveLoans = member.memberType === 'Teacher' ? 300 : 1
    if (Number(loanCount.activeLoans) + totalQuantity > maximumActiveLoans) {
      await connection.rollback()
      return res.status(409).json({
        error: `${member.memberType}s may have at most ${maximumActiveLoans} active book${maximumActiveLoans === 1 ? '' : 's'} at a time; this member has ${loanCount.activeLoans} active book${Number(loanCount.activeLoans) === 1 ? '' : 's'}.`,
      })
    }

    const booksById = new Map()
    for (const { bookId } of [...normalizedItems].sort((left, right) => left.bookId - right.bookId)) {
      const [[book]] = await connection.execute(
        'SELECT id, title, available_copies FROM books WHERE id = ? FOR UPDATE',
        [bookId],
      )
      if (!book) {
        await connection.rollback()
        return res.status(404).json({ error: 'One of the selected books was not found.' })
      }
      booksById.set(bookId, book)
    }

    for (const item of normalizedItems) {
      const book = booksById.get(item.bookId)
      if (Number(book.available_copies) < item.quantity) {
        await connection.rollback()
        return res.status(409).json({ error: `Only ${book.available_copies} ${Number(book.available_copies) === 1 ? 'copy is' : 'copies are'} available for "${book.title}".` })
      }
      if (item.copyCode) {
        const [[existingCopy]] = await connection.execute(
          'SELECT id FROM loans WHERE book_id = ? AND copy_code = ? AND quantity > returned_quantity + missed_quantity LIMIT 1 FOR UPDATE',
          [item.bookId, item.copyCode],
        )
        if (existingCopy) {
          await connection.rollback()
          return res.status(409).json({ error: `Copy code "${item.copyCode}" is already checked out.` })
        }
      }
    }

    const createdLoans = []
    for (const item of normalizedItems) {
      const book = booksById.get(item.bookId)
      const [result] = await connection.execute(
        'INSERT INTO loans (book_id, member_id, issued_at, due_date, quantity, copy_code) VALUES (?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)',
        [item.bookId, memberId, checkoutDate === formatLocalDate(new Date()) ? null : `${checkoutDate} 12:00:00`, dueDate, item.quantity, item.copyCode || null],
      )
      await connection.execute(
        'UPDATE books SET available_copies = available_copies - ? WHERE id = ?',
        [item.quantity, item.bookId],
      )
      createdLoans.push({
        id: result.insertId,
        bookId: item.bookId,
        bookTitle: book.title,
        quantity: item.quantity,
        copyCode: item.copyCode || null,
      })
    }
    const details = `${totalQuantity} copies across ${createdLoans.length} title(s) checked out to ${member.name} on ${checkoutDate}: ${createdLoans.map((loan) => loan.bookTitle).join(', ')}`.slice(0, 500)
    await audit(connection, req.user.name, 'Books checked out', details)
    await connection.commit()
    res.status(201).json({ memberId, memberName: member.name, issuedAt: checkoutDate, dueDate, loans: createdLoans })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}))

app.get('/api/library-visits', ...staff, asyncRoute(async (req, res) => {
  const visitDate = String(req.query.date || formatLocalDate(new Date()))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)
    || Number.isNaN(Date.parse(`${visitDate}T00:00:00Z`))
    || new Date(`${visitDate}T00:00:00Z`).toISOString().slice(0, 10) !== visitDate) {
    return res.status(400).json({ error: 'Visit date must be a valid date in YYYY-MM-DD format.' })
  }
  const [visits] = await pool.execute(
    `SELECT v.id, v.member_id AS memberId, m.name AS memberName,
       m.membership_number AS membershipNumber, m.member_type AS memberType,
       m.class_section AS classSection, b.id AS bookId, b.title AS bookTitle,
       DATE_FORMAT(v.visit_date, '%Y-%m-%d') AS visitDate,
       DATE_FORMAT(CONVERT_TZ(v.visited_at, @@session.time_zone, '+02:00'), '%H:%i') AS visitTime, v.recorded_by AS recordedBy
     FROM library_visits v
     JOIN members m ON m.id = v.member_id
     LEFT JOIN books b ON b.id = v.book_id
     WHERE v.visit_date = ?
     ORDER BY v.visited_at DESC, v.id DESC`,
    [visitDate],
  )
  res.json(visits.map((visit) => ({
    ...visit,
    id: Number(visit.id),
    memberId: Number(visit.memberId),
    bookId: visit.bookId === null ? null : Number(visit.bookId),
  })))
}))

app.get('/api/library-visits/summary', ...staff, asyncRoute(async (req, res) => {
  const days = Number(req.query.days || 30)
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    return res.status(400).json({ error: 'Summary period must be between 1 and 365 days.' })
  }
  const asOfDate = String(req.query.date || formatLocalDate(new Date()))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)
    || Number.isNaN(Date.parse(`${asOfDate}T00:00:00Z`))
    || new Date(`${asOfDate}T00:00:00Z`).toISOString().slice(0, 10) !== asOfDate) {
    return res.status(400).json({ error: 'Summary date must be a valid date in YYYY-MM-DD format.' })
  }
  const [[today]] = await pool.execute(
    `SELECT COUNT(*) AS visitsToday, COUNT(DISTINCT member_id) AS uniqueVisitorsToday
     FROM library_visits WHERE visit_date = ?`,
    [asOfDate],
  )
  const [[period]] = await pool.execute(
    `SELECT COUNT(*) AS visits, COUNT(DISTINCT member_id) AS uniqueVisitors
     FROM library_visits WHERE visit_date BETWEEN DATE_SUB(?, INTERVAL ? DAY) AND ?`,
    [asOfDate, days - 1, asOfDate],
  )
  const [frequentUsers] = await pool.execute(
    `SELECT m.id AS memberId, m.name, m.membership_number AS membershipNumber,
       m.member_type AS memberType, m.class_section AS classSection,
       COUNT(v.id) AS visitCount,
       COUNT(DISTINCT v.visit_date) AS daysVisited,
       DATE_FORMAT(CONVERT_TZ(MAX(v.visited_at), @@session.time_zone, '+02:00'), '%Y-%m-%d %H:%i') AS lastVisit
     FROM library_visits v JOIN members m ON m.id = v.member_id
     WHERE v.visit_date BETWEEN DATE_SUB(?, INTERVAL ? DAY) AND ?
     GROUP BY m.id, m.name, m.membership_number, m.member_type, m.class_section
     ORDER BY visitCount DESC, daysVisited DESC, m.name LIMIT 10`,
    [asOfDate, days - 1, asOfDate],
  )
  const [popularBooks] = await pool.execute(
    `SELECT b.id AS bookId, b.title, COUNT(v.id) AS readingCount
     FROM library_visits v JOIN books b ON b.id = v.book_id
     WHERE v.visit_date BETWEEN DATE_SUB(?, INTERVAL ? DAY) AND ?
     GROUP BY b.id, b.title ORDER BY readingCount DESC, b.title LIMIT 5`,
    [asOfDate, days - 1, asOfDate],
  )
  res.json({
    days,
    asOfDate,
    visitsToday: Number(today.visitsToday),
    uniqueVisitorsToday: Number(today.uniqueVisitorsToday),
    periodVisits: Number(period.visits),
    periodUniqueVisitors: Number(period.uniqueVisitors),
    frequentUsers: frequentUsers.map((member) => ({
      ...member,
      memberId: Number(member.memberId),
      visitCount: Number(member.visitCount),
      daysVisited: Number(member.daysVisited),
    })),
    popularBooks: popularBooks.map((book) => ({
      ...book,
      bookId: Number(book.bookId),
      readingCount: Number(book.readingCount),
    })),
  })
}))

app.post('/api/library-visits', ...canManage, asyncRoute(async (req, res) => {
  const memberId = Number(req.body.memberId)
  const bookId = req.body.bookId ? Number(req.body.bookId) : null
  const visitDate = String(req.body.visitDate || formatLocalDate(new Date()))
  if (!Number.isInteger(memberId) || memberId < 1 || (bookId !== null && (!Number.isInteger(bookId) || bookId < 1))) {
    return res.status(400).json({ error: 'Select a valid library member and book.' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)
    || Number.isNaN(Date.parse(`${visitDate}T00:00:00Z`))
    || new Date(`${visitDate}T00:00:00Z`).toISOString().slice(0, 10) !== visitDate) {
    return res.status(400).json({ error: 'Visit date must be a valid date in YYYY-MM-DD format.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[member]] = await connection.execute(
      'SELECT id, name FROM members WHERE id = ? AND status = ? FOR UPDATE',
      [memberId, 'Active'],
    )
    if (!member) {
      await connection.rollback()
      return res.status(404).json({ error: 'Active library member not found.' })
    }
    let book = null
    if (bookId !== null) {
      const [[selectedBook]] = await connection.execute('SELECT id, title FROM books WHERE id = ?', [bookId])
      if (!selectedBook) {
        await connection.rollback()
        return res.status(404).json({ error: 'Selected reading book was not found.' })
      }
      book = selectedBook
    }
    const [result] = await connection.execute(
      'INSERT INTO library_visits (member_id, book_id, visit_date, recorded_by) VALUES (?, ?, ?, ?)',
      [memberId, bookId, visitDate, req.user.name],
    )
    await audit(connection, req.user.name, 'Library visit recorded', `${member.name} visited the library${book ? ` to read "${book.title}"` : ''}`)
    await connection.commit()
    res.status(201).json({
      id: Number(result.insertId),
      memberId,
      memberName: member.name,
      bookId,
      bookTitle: book?.title || null,
      visitDate,
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}))

app.get('/api/export/library-visits.csv', ...staff, asyncRoute(async (req, res) => {
  const visitDate = String(req.query.date || formatLocalDate(new Date()))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)
    || Number.isNaN(Date.parse(`${visitDate}T00:00:00Z`))
    || new Date(`${visitDate}T00:00:00Z`).toISOString().slice(0, 10) !== visitDate) {
    return res.status(400).json({ error: 'Visit date must be a valid date in YYYY-MM-DD format.' })
  }
  const [visits] = await pool.execute(
    `SELECT DATE_FORMAT(v.visit_date, '%Y-%m-%d') AS visitDate,
       DATE_FORMAT(CONVERT_TZ(v.visited_at, @@session.time_zone, '+02:00'), '%H:%i') AS visitTime, m.name AS memberName,
       m.membership_number AS membershipNumber, m.member_type AS memberType,
       m.class_section AS classSection, b.title AS bookTitle, v.recorded_by AS recordedBy
     FROM library_visits v JOIN members m ON m.id = v.member_id
     LEFT JOIN books b ON b.id = v.book_id
     WHERE v.visit_date = ? ORDER BY v.visited_at DESC, v.id DESC`,
    [visitDate],
  )
  const columns = ['visitDate', 'visitTime', 'memberName', 'membershipNumber', 'memberType', 'classSection', 'bookTitle', 'recordedBy']
  res.type('text/csv').attachment(`gs-busanza-library-attendance-${visitDate}.csv`).send(csvDocument(columns, visits))
}))

app.post('/api/loans/:id/return', ...canManage, asyncRoute(async (req, res) => {
  const quantity = Number(req.body.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 300) {
    return res.status(400).json({ error: 'Enter a return quantity from 1 to 300.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[loan]] = await connection.execute(
      `SELECT l.id, l.book_id AS bookId, l.quantity, l.returned_quantity AS returnedQuantity,
       l.missed_quantity AS missedQuantity, l.missed_at AS missedAt, b.title
       FROM loans l JOIN books b ON b.id = l.book_id WHERE l.id = ? FOR UPDATE`,
      [req.params.id],
    )
    if (!loan) {
      await connection.rollback()
      return res.status(404).json({ error: 'Loan not found.' })
    }
    const outstanding = Number(loan.quantity) - Number(loan.returnedQuantity) - Number(loan.missedQuantity)
    if (outstanding < 1) {
      await connection.rollback()
      return res.status(409).json({ error: 'There are no outstanding copies left on this checkout.' })
    }
    if (quantity > outstanding) {
      await connection.rollback()
      return res.status(400).json({ error: `Only ${outstanding} outstanding ${outstanding === 1 ? 'copy remains' : 'copies remain'} on this checkout.` })
    }
    const returnedQuantity = Number(loan.returnedQuantity) + quantity
    const complete = returnedQuantity + Number(loan.missedQuantity) === Number(loan.quantity)
    await connection.execute(
      `UPDATE loans SET returned_quantity = ?, returned_at = ${complete ? 'CURRENT_TIMESTAMP' : 'NULL'}
       WHERE id = ?`,
      [returnedQuantity, loan.id],
    )
    await connection.execute(
      'UPDATE books SET available_copies = LEAST(total_copies, available_copies + ?) WHERE id = ?',
      [quantity, loan.bookId],
    )
    await audit(connection, req.user.name, 'Book returned', `${quantity} ${loan.title} ${quantity === 1 ? 'copy' : 'copies'} returned to the library`)
    await connection.commit()
    res.json({ message: `${quantity} ${quantity === 1 ? 'copy' : 'copies'} returned successfully.`, returnedQuantity, outstandingQuantity: outstanding - quantity })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}))

app.post('/api/loans/:id/missed', ...canManage, asyncRoute(async (req, res) => {
  const quantity = Number(req.body.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 300) {
    return res.status(400).json({ error: 'Enter a missed quantity from 1 to 300.' })
  }
  const connection = await pool.getConnection()
  let connectionReleased = false
  try {
    await connection.beginTransaction()
    const [[loan]] = await connection.execute(
      `SELECT l.id, l.book_id AS bookId, l.member_id AS memberId,
       l.quantity, l.returned_quantity AS returnedQuantity,
       l.missed_quantity AS missedQuantity, l.missed_at AS missedAt,
       b.title, m.name AS memberName
       FROM loans l JOIN books b ON b.id = l.book_id
       JOIN members m ON m.id = l.member_id
       WHERE l.id = ? FOR UPDATE`,
      [req.params.id],
    )
    if (!loan) {
      await connection.rollback()
      return res.status(404).json({ error: 'Loan not found.' })
    }
    const outstanding = Number(loan.quantity) - Number(loan.returnedQuantity) - Number(loan.missedQuantity)
    if (outstanding < 1) {
      await connection.rollback()
      return res.status(409).json({ error: 'There are no outstanding copies left on this checkout.' })
    }
    if (quantity > outstanding) {
      await connection.rollback()
      return res.status(400).json({ error: `Only ${outstanding} outstanding ${outstanding === 1 ? 'copy remains' : 'copies remain'} on this checkout.` })
    }
    const [[book]] = await connection.execute(
      'SELECT total_copies FROM books WHERE id = ? FOR UPDATE',
      [loan.bookId],
    )
    const missedQuantity = Number(loan.missedQuantity) + quantity
    const complete = Number(loan.returnedQuantity) + missedQuantity === Number(loan.quantity)
    if (!book || Number(book.total_copies) < quantity) {
      await connection.rollback()
      return res.status(409).json({ error: 'The catalog copy count cannot be reduced for this loan.' })
    }
    await connection.execute(
      `UPDATE loans SET missed_quantity = ?, missed_at = COALESCE(missed_at, CURRENT_TIMESTAMP),
       returned_at = ${complete ? 'NULL' : 'returned_at'} WHERE id = ?`,
      [missedQuantity, loan.id],
    )
    await connection.execute('UPDATE books SET total_copies = total_copies - ? WHERE id = ?', [quantity, loan.bookId])
    await audit(connection, req.user.name, 'Book marked missed', `${quantity} ${loan.title} ${quantity === 1 ? 'copy' : 'copies'} marked missed by ${loan.memberName}; removed from inventory`)
    await connection.commit()
    connection.release()
    connectionReleased = true
    res.json({ message: `${quantity} ${quantity === 1 ? 'copy' : 'copies'} marked missed and removed from the catalog.`, missedQuantity, outstandingQuantity: outstanding - quantity })
  } catch (error) {
    if (!connectionReleased) await connection.rollback()
    throw error
  } finally {
    if (!connectionReleased) connection.release()
  }
}))

app.post('/api/loans/:id/recover', ...canManage, asyncRoute(async (req, res) => {
  const quantity = Number(req.body.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 300) {
    return res.status(400).json({ error: 'Enter a recovered quantity from 1 to 300.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[loan]] = await connection.execute(
      `SELECT l.id, l.book_id AS bookId, l.quantity,
       l.returned_quantity AS returnedQuantity, l.missed_quantity AS missedQuantity,
       b.title, m.name AS memberName
       FROM loans l JOIN books b ON b.id = l.book_id
       JOIN members m ON m.id = l.member_id
       WHERE l.id = ? FOR UPDATE`,
      [req.params.id],
    )
    if (!loan) {
      await connection.rollback()
      return res.status(404).json({ error: 'Loan not found.' })
    }
    if (quantity > Number(loan.missedQuantity)) {
      await connection.rollback()
      return res.status(400).json({
        error: `Only ${loan.missedQuantity} ${Number(loan.missedQuantity) === 1 ? 'copy was' : 'copies were'} marked missing on this checkout.`,
      })
    }
    const [[book]] = await connection.execute(
      'SELECT total_copies, available_copies FROM books WHERE id = ? FOR UPDATE',
      [loan.bookId],
    )
    if (!book) {
      await connection.rollback()
      return res.status(404).json({ error: 'Book not found.' })
    }
    const returnedQuantity = Number(loan.returnedQuantity) + quantity
    const missedQuantity = Number(loan.missedQuantity) - quantity
    const complete = returnedQuantity + missedQuantity === Number(loan.quantity)
    const returnedAt = complete && missedQuantity === 0 ? 'CURRENT_TIMESTAMP' : 'NULL'
    await connection.execute(
      `UPDATE loans SET returned_quantity = ?, missed_quantity = ?,
       returned_at = ${returnedAt} WHERE id = ?`,
      [returnedQuantity, missedQuantity, loan.id],
    )
    await connection.execute(
      'UPDATE books SET total_copies = total_copies + ?, available_copies = available_copies + ? WHERE id = ?',
      [quantity, quantity, loan.bookId],
    )
    await audit(
      connection,
      req.user.name,
      'Book found',
      `${quantity} ${loan.title} ${quantity === 1 ? 'copy' : 'copies'} previously marked missing ${quantity === 1 ? 'was' : 'were'} found and returned to available inventory from ${loan.memberName}`,
    )
    await connection.commit()
    res.json({
      message: `${quantity} ${quantity === 1 ? 'copy' : 'copies'} found and restored to the catalog.`,
      returnedQuantity,
      missedQuantity,
    })
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}))

app.post('/api/loans/:id/reconcile', ...canManage, asyncRoute(async (req, res) => {
  const returnedQuantityInput = Number(req.body.returnedQuantity)
  const missedQuantityInput = Number(req.body.missedQuantity)
  if (!Number.isInteger(returnedQuantityInput) || returnedQuantityInput < 0 || returnedQuantityInput > 300
    || !Number.isInteger(missedQuantityInput) || missedQuantityInput < 0 || missedQuantityInput > 300
    || returnedQuantityInput + missedQuantityInput < 1) {
    return res.status(400).json({ error: 'Enter at least one returned or missing copy, using quantities from 0 to 300.' })
  }
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [[loan]] = await connection.execute(
      `SELECT l.id, l.book_id AS bookId, l.quantity,
       l.returned_quantity AS returnedQuantity, l.missed_quantity AS missedQuantity,
       b.title, m.name AS memberName
       FROM loans l JOIN books b ON b.id = l.book_id
       JOIN members m ON m.id = l.member_id
       WHERE l.id = ? FOR UPDATE`,
      [req.params.id],
    )
    if (!loan) {
      await connection.rollback()
      return res.status(404).json({ error: 'Loan not found.' })
    }
    const outstanding = Number(loan.quantity) - Number(loan.returnedQuantity) - Number(loan.missedQuantity)
    if (returnedQuantityInput + missedQuantityInput > outstanding) {
      await connection.rollback()
      return res.status(400).json({ error: `Only ${outstanding} outstanding ${outstanding === 1 ? 'copy remains' : 'copies remain'} on this checkout.` })
    }
    if (missedQuantityInput > 0) {
      const [[book]] = await connection.execute(
        'SELECT total_copies FROM books WHERE id = ? FOR UPDATE',
        [loan.bookId],
      )
      if (!book || Number(book.total_copies) < missedQuantityInput) {
        await connection.rollback()
        return res.status(409).json({ error: 'The catalog copy count cannot be reduced for this loan.' })
      }
      await connection.execute(
        'UPDATE books SET total_copies = total_copies - ? WHERE id = ?',
        [missedQuantityInput, loan.bookId],
      )
    }
    if (returnedQuantityInput > 0) {
      await connection.execute(
        'UPDATE books SET available_copies = LEAST(total_copies, available_copies + ?) WHERE id = ?',
        [returnedQuantityInput, loan.bookId],
      )
    }
    const returnedQuantity = Number(loan.returnedQuantity) + returnedQuantityInput
    const missedQuantity = Number(loan.missedQuantity) + missedQuantityInput
    const complete = returnedQuantity + missedQuantity === Number(loan.quantity)
    const returnedAt = complete && missedQuantity === 0 ? 'CURRENT_TIMESTAMP' : 'NULL'
    const missedAt = missedQuantity > 0 ? 'COALESCE(missed_at, CURRENT_TIMESTAMP)' : 'missed_at'
    await connection.execute(
      `UPDATE loans SET returned_quantity = ?, missed_quantity = ?,
       returned_at = ${returnedAt}, missed_at = ${missedAt} WHERE id = ?`,
      [returnedQuantity, missedQuantity, loan.id],
    )
    await audit(
      connection,
      req.user.name,
      'Book return reconciled',
      `${returnedQuantityInput} ${returnedQuantityInput === 1 ? 'copy' : 'copies'} returned and ${missedQuantityInput} marked missing for "${loan.title}" from ${loan.memberName}`,
    )
    await connection.commit()
    res.json({
      returnedQuantity,
      missedQuantity,
      outstandingQuantity: outstanding - returnedQuantityInput - missedQuantityInput,
    })
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
  const search = `%${String(_req.query.search || '').trim()}%`
  const [books] = await pool.query(
    `SELECT title, isbn, publisher, author, category, grade, book_type, shelf,
       total_copies AS total_copies, available_copies AS available_copies,
       DATE_FORMAT(delivered_on, '%Y-%m-%d') AS date_delivered,
       published_year AS publication_year
     FROM books
     WHERE title LIKE ? OR author LIKE ? OR publisher LIKE ? OR isbn LIKE ? OR category LIKE ? OR grade LIKE ? OR book_type LIKE ? OR shelf LIKE ?
     ORDER BY title`,
    [search, search, search, search, search, search, search, search],
  )
  const columns = ['title', 'isbn', 'publisher', 'author', 'category', 'grade', 'book_type', 'shelf', 'total_copies', 'available_copies', 'date_delivered', 'publication_year']
  const csv = csvDocument(columns, books)
  res.type('text/csv').attachment('library-catalog.csv').send(csv)
}))

app.get('/api/export/members.csv', ...staff, asyncRoute(async (_req, res) => {
  const [members] = await pool.query(
    `SELECT membership_number, name, member_type, class_section, email, phone, status,
       DATE_FORMAT(joined_at, '%Y-%m-%d') AS joined_at
     FROM members ORDER BY member_type, class_section, name`,
  )
  const columns = ['name', 'member_type', 'class_section', 'membership_number', 'email', 'phone', 'status', 'joined_at']
  res.type('text/csv').attachment('gs-busanza-members.csv').send(csvDocument(columns, members))
}))

app.get('/api/export/reports.csv', ...staff, asyncRoute(async (req, res) => {
  const dateColumn = req.query.status === 'Returned'
    ? 'l.returned_at'
    : req.query.status === 'Missed' ? 'l.missed_at' : 'l.issued_at'
  const filters = reportFilters(req.query, true, dateColumn)
  if (filters.error) return res.status(400).json({ error: filters.error })
  const [rows] = await pool.execute(
    `${loanReportSelect} ${filters.where} ORDER BY l.issued_at DESC, m.name`,
    filters.params,
  )
  const columns = [
    'issuedAt', 'memberName', 'membershipNumber', 'memberType', 'classSection',
    'email', 'bookTitle', 'isbn', 'copyCode', 'quantity', 'returnedQuantity',
    'missedQuantity', 'outstandingQuantity', 'dueDate', 'returnedAt', 'missedAt', 'status',
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
    console.error('Database schema is missing. Configure MySQL and run "npm run db:setup" for a new database or "npm run db:migrate:directory" for an existing database.')
    return res.status(503).json({ error: 'Database schema is missing. Run npm run db:setup for a new database or npm run db:migrate:directory for an existing database.' })
  }
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND' || error.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('Could not connect to MySQL. Check DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, and DB_SSL.')
    return res.status(503).json({ error: 'Could not connect to the library database. Check the deployment database settings.' })
  }
  console.error(error)
  return res.status(500).json({ error: 'An unexpected server error occurred.' })
})

export default app
