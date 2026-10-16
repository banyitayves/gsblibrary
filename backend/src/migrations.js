const directoryColumns = [
  ['phone', 'VARCHAR(32) NULL'],
  ['member_type', "ENUM('Student', 'Teacher') NOT NULL DEFAULT 'Student'"],
  ['class_section', 'VARCHAR(20) NULL'],
]

export async function migrateSchoolDirectory(connection) {
  const [bookColumns] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'books'`,
  )
  const existingBookColumns = new Set(bookColumns.map((column) => column.COLUMN_NAME))
  if (!existingBookColumns.has('isbn')) {
    throw new Error('The books.isbn column is missing; cannot migrate the book catalog.')
  }
  await connection.query('ALTER TABLE books MODIFY isbn VARCHAR(32) NULL')
  if (existingBookColumns.has('author')) {
    await connection.query('ALTER TABLE books MODIFY author VARCHAR(180) NULL')
  }
  for (const [name, definition] of [
    ['publisher', 'VARCHAR(180) NULL'],
    ['grade', 'VARCHAR(40) NULL'],
    ['delivered_on', 'DATE NULL'],
  ]) {
    if (!existingBookColumns.has(name)) {
      await connection.query(`ALTER TABLE books ADD COLUMN ${name} ${definition}`)
    }
  }

  const [columns] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members'`,
  )
  const existingColumns = new Set(columns.map((column) => column.COLUMN_NAME))
  const [indexes] = await connection.execute(
    `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members'`,
  )
  const existingIndexes = new Set(indexes.map((index) => index.INDEX_NAME))

  if (!existingColumns.has('email')) {
    throw new Error('The members.email column is missing; cannot migrate the school directory.')
  }
  await connection.query('ALTER TABLE members MODIFY email VARCHAR(190) NULL')

  for (const [name, definition] of directoryColumns) {
    if (!existingColumns.has(name)) {
      await connection.query(`ALTER TABLE members ADD COLUMN ${name} ${definition}`)
    }
  }
  if (!existingIndexes.has('idx_members_class_section')) {
    await connection.query('CREATE INDEX idx_members_class_section ON members (class_section)')
  }
  if (!existingIndexes.has('idx_members_type')) {
    await connection.query('CREATE INDEX idx_members_type ON members (member_type)')
  }
  const [loanColumns] = await connection.execute(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loans'`,
  )
  if (!loanColumns.some((column) => column.COLUMN_NAME === 'copy_code')) {
    await connection.query('ALTER TABLE loans ADD COLUMN copy_code VARCHAR(64) NULL')
  }
  const [loanIndexes] = await connection.execute(
    `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'loans'`,
  )
  if (!loanIndexes.some((index) => index.INDEX_NAME === 'idx_loans_copy_code')) {
    await connection.query('CREATE INDEX idx_loans_copy_code ON loans (copy_code, returned_at)')
  }
  await connection.execute(
    `UPDATE users SET name = ? WHERE role = 'Librarian' AND name <> ?`,
    ['NSHIMIYIMANA Yves', 'NSHIMIYIMANA Yves'],
  )
}
