import bcrypt from 'bcryptjs'
import { pool } from './db.js'

async function updateLibrarianLogin() {
  const username = String(process.env.LIBRARIAN_USERNAME || '').trim().toLowerCase()
  const password = String(process.env.LIBRARIAN_PASSWORD || '')
  if (!username || username.length > 190 || !password || password.length < 12) {
    throw new Error('Set LIBRARIAN_USERNAME (up to 190 characters) and LIBRARIAN_PASSWORD (at least 12 characters).')
  }

  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    const [librarians] = await connection.execute(
      `SELECT id FROM users WHERE role = 'Librarian' ORDER BY id LIMIT 2 FOR UPDATE`,
    )
    if (librarians.length !== 1) {
      throw new Error(`Expected exactly one librarian account; found ${librarians.length}.`)
    }
    const librarianId = librarians[0].id
    const [[existing]] = await connection.execute(
      'SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1',
      [username, librarianId],
    )
    if (existing) throw new Error('That username is already assigned to another account.')

    const passwordHash = await bcrypt.hash(password, 12)
    await connection.execute(
      'UPDATE users SET email = ?, password_hash = ?, name = ? WHERE id = ?',
      [username, passwordHash, 'NSHIMIYIMANA Yves', librarianId],
    )
    await connection.commit()
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

try {
  await updateLibrarianLogin()
  console.log('Librarian login credentials updated. The password was not displayed.')
} catch (error) {
  console.error('Could not update librarian login:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
