import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const databaseName = process.env.DB_NAME || 'library_management'

if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error('DB_NAME may only contain letters, numbers, and underscores.')
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'library_app',
    password: process.env.DB_PASSWORD || '',
    name: databaseName,
  },
  jwtSecret: process.env.JWT_SECRET,
}

export function requireJwtSecret() {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    throw new Error('Set JWT_SECRET to a random secret of at least 32 characters in the root .env file.')
  }
}
