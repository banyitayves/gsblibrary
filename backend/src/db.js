import mysql from 'mysql2/promise'
import { config } from './config.js'

export const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 5,
  idleTimeout: 60_000,
  queueLimit: 0,
  dateStrings: ['DATE'],
})
