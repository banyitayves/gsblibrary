import app from './app.js'
import { config, requireJwtSecret } from './config.js'
import { pool } from './db.js'

async function start() {
  requireJwtSecret()
  await pool.query('SELECT 1')
  app.listen(config.port, () => {
    console.log(`Library API listening at http://localhost:${config.port}`)
  })
}

start().catch((error) => {
  console.error(`Could not start the API: ${error.message}`)
  console.error('Check MySQL is running, your .env settings, and run npm run db:setup.')
  process.exitCode = 1
})
