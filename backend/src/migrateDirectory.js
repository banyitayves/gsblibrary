import { pool } from './db.js'
import { migrateSchoolDirectory } from './migrations.js'

try {
  const connection = await pool.getConnection()
  try {
    await migrateSchoolDirectory(connection)
  } finally {
    connection.release()
  }
  console.log('School directory schema and librarian name are up to date.')
} catch (error) {
  console.error('School directory migration failed:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
