import { pool } from './db.js'
import { ensurePastPapersTable, migrateSchoolDirectory } from './migrations.js'

try {
  const connection = await pool.getConnection()
  try {
    await migrateSchoolDirectory(connection)
    await ensurePastPapersTable(connection)
  } finally {
    connection.release()
  }
  console.log('School directory and password reset schemas are up to date.')
} catch (error) {
  console.error('School directory migration failed:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
