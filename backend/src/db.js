import mysql from 'mysql2/promise'
import { config } from './config.js'

export const databaseSsl = process.env.DB_SSL === 'true'
  ? {
      rejectUnauthorized: true,
      ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
    }
  : undefined

export const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  ssl: databaseSsl,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 5,
  maxIdle: 2,
  idleTimeout: 60_000,
  queueLimit: 0,
  connectTimeout: 10_000,
  enableKeepAlive: true,
  dateStrings: ['DATE'],
})
