import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

const databaseName = process.env.DB_NAME || 'library_management'
const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((url) => url.trim().replace(/\/+$/, ''))
  .filter(Boolean)

if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error('DB_NAME may only contain letters, numbers, and underscores.')
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  clientUrls,
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'library_app',
    password: process.env.DB_PASSWORD || '',
    name: databaseName,
  },
  jwtSecret: process.env.JWT_SECRET,
  passwordResetEmail: process.env.PASSWORD_RESET_EMAIL || process.env.OTP_DELIVERY_EMAIL || '',
  publicAppUrl: process.env.PUBLIC_APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : clientUrls[0] || ''),
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    fromEmail: process.env.SMTP_FROM_EMAIL || '',
    fromName: process.env.SMTP_FROM_NAME || 'GS Busanza Library',
  },
}

export function isSmtpConfigured() {
  return Boolean(
    config.smtp.host
    && config.smtp.user
    && config.smtp.password
    && config.smtp.fromEmail
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.smtp.fromEmail),
  )
}

export function requireJwtSecret() {
  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    const error = new Error('Set JWT_SECRET to a random secret of at least 32 characters in the deployment environment.')
    error.code = 'MISSING_JWT_SECRET'
    throw error
  }
}
