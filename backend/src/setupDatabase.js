import { readFile } from 'node:fs/promises'
import { createConnection } from 'mysql2/promise'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { pool } from './db.js'

const demoBooks = [
  ['BK-1024', 'The Pragmatic Programmer', 'Andrew Hunt', 'Technology', 'A1-12', 5, '1999-10-20'],
  ['BK-2048', 'Atomic Habits', 'James Clear', 'Personal development', 'B4-02', 4, '2018-10-16'],
  ['BK-3410', 'The Alchemist', 'Paulo Coelho', 'Fiction', 'C3-09', 3, '1988-01-01'],
  ['BK-4411', 'Clean Code', 'Robert C. Martin', 'Technology', 'A2-07', 3, '2008-08-01'],
  ['BK-5120', 'Deep Work', 'Cal Newport', 'Productivity', 'D1-05', 4, '2016-01-05'],
  ['BK-6177', 'The Silent Patient', 'Alex Michaelides', 'Mystery', 'B2-14', 2, '2019-02-05'],
  ['BK-7280', 'Educated', 'Tara Westover', 'Memoir', 'C1-03', 3, '2018-02-20'],
  ['BK-8392', 'Project Hail Mary', 'Andy Weir', 'Science fiction', 'D2-08', 3, '2021-05-04'],
]

const demoMembers = [
  ['M-1001', 'Maya Clark', 'maya.clark@example.com'],
  ['M-1002', 'Nia Lopez', 'nia.lopez@example.com'],
  ['M-1003', 'Ethan Brooks', 'ethan.brooks@example.com'],
  ['M-1004', 'Sofia Patel', 'sofia.patel@example.com'],
  ['M-1005', 'Oliver Chen', 'oliver.chen@example.com'],
]

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function seedDatabase(connection) {
  const [[{ bookCount }]] = await connection.query('SELECT COUNT(*) AS bookCount FROM books')
  if (Number(bookCount) === 0) {
    for (const [isbn, title, author, category, shelf, copies, publishedOn] of demoBooks) {
      await connection.execute(
        `INSERT INTO books (isbn, title, author, category, shelf, total_copies, published_on)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [isbn, title, author, category, shelf, copies, publishedOn],
      )
    }
  }

  const [[{ memberCount }]] = await connection.query('SELECT COUNT(*) AS memberCount FROM members')
  if (Number(memberCount) === 0) {
    for (const [membershipNumber, name, email] of demoMembers) {
      await connection.execute(
        'INSERT INTO members (membership_number, name, email) VALUES (?, ?, ?)',
        [membershipNumber, name, email],
      )
    }
  }

  const [[{ userCount }]] = await connection.query('SELECT COUNT(*) AS userCount FROM users')
  if (Number(userCount) === 0) {
    const passwordHash = await bcrypt.hash('admin123', 12)
    await connection.execute(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES (?, ?, ?, 'Administrator')`,
      ['Aisha Khan', 'admin@library.local', passwordHash],
    )
    const librarianHash = await bcrypt.hash('lib123', 12)
    await connection.execute(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES (?, ?, ?, 'Librarian')`,
      ['Nora James', 'librarian@library.local', librarianHash],
    )
  }

  const [[{ loanCount }]] = await connection.query('SELECT COUNT(*) AS loanCount FROM loans')
  if (Number(loanCount) === 0) {
    const [mayaRows] = await connection.execute(
      'SELECT id AS memberId FROM members WHERE membership_number = ?',
      ['M-1001'],
    )
    const [niaRows] = await connection.execute(
      'SELECT id AS memberId FROM members WHERE membership_number = ?',
      ['M-1002'],
    )
    const [habitsRows] = await connection.execute(
      'SELECT id AS bookId FROM books WHERE isbn = ?',
      ['BK-2048'],
    )
    const [cleanCodeRows] = await connection.execute(
      'SELECT id AS bookId FROM books WHERE isbn = ?',
      ['BK-4411'],
    )
    if (mayaRows[0] && niaRows[0] && habitsRows[0] && cleanCodeRows[0]) {
      const today = new Date()
      const dueIn = new Date(today)
      dueIn.setDate(today.getDate() + 12)
      const overdue = new Date(today)
      overdue.setDate(today.getDate() - 4)

      await connection.execute(
        `INSERT INTO loans (book_id, member_id, due_date) VALUES (?, ?, ?), (?, ?, ?)`,
        [habitsRows[0].bookId, mayaRows[0].memberId, formatDate(dueIn), cleanCodeRows[0].bookId, niaRows[0].memberId, formatDate(overdue)],
      )
      await connection.execute(
        'UPDATE books SET available_copies = available_copies - 1 WHERE id IN (?, ?)',
        [habitsRows[0].bookId, cleanCodeRows[0].bookId],
      )
    }
  }

  const [[{ auditCount }]] = await connection.query('SELECT COUNT(*) AS auditCount FROM audit_logs')
  if (Number(auditCount) === 0) {
    await connection.execute(
      `INSERT INTO audit_logs (actor, action, details) VALUES
       ('Nora James', 'Catalog prepared', 'Sample titles added to the library catalog'),
       ('Aisha Khan', 'Library opened', 'LibraryFlow is ready to use')`,
    )
  }
}

async function setupDatabase() {
  const adminConnection = await createConnection({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
  })

  try {
    const [databases] = await adminConnection.execute(
      'SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [config.database.name],
    )
    if (databases.length === 0) {
      await adminConnection.query(
        `CREATE DATABASE \`${config.database.name}\`
         CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      )
    }
  } finally {
    await adminConnection.end()
  }

  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
  const connection = await pool.getConnection()
  try {
    for (const statement of schema.split(';').map((sql) => sql.trim()).filter(Boolean)) {
      await connection.query(statement)
    }
    await seedDatabase(connection)
  } finally {
    connection.release()
  }
}

try {
  await setupDatabase()
  console.log(`MySQL database "${config.database.name}" is ready.`)
  console.log('Demo sign-in: admin@library.local / admin123')
  await pool.end()
} catch (error) {
  console.error('Database setup failed:', error.message)
  console.error('Check the MySQL service and DB_* settings in the root .env file.')
  await pool.end()
  process.exitCode = 1
}
