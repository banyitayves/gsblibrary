import nodemailer from 'nodemailer'
import { config, isSmtpConfigured } from './config.js'
import { pool } from './db.js'

const transporter = isSmtpConfigured()
  ? nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    })
  : null

let dispatching = false

export async function sendEmail({ to, name, subject, text }) {
  if (!transporter) {
    throw new Error('SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM_EMAIL.')
  }
  return transporter.sendMail({
    from: { name: config.smtp.fromName, address: config.smtp.fromEmail },
    to: { name, address: to },
    subject,
    text,
  })
}

export async function enqueueEmail(connection, message) {
  await connection.execute(
    `INSERT INTO email_outbox
      (event_key, event_type, recipient, recipient_name, subject, text_body)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [message.eventKey, message.eventType, message.to, message.name, message.subject, message.text],
  )
}

export async function dispatchEmailOutbox(limit = 10) {
  if (!transporter || dispatching) return
  dispatching = true
  let connection
  let transactionOpen = false
  try {
    connection = await pool.getConnection()
    await connection.beginTransaction()
    transactionOpen = true
    const [messages] = await connection.execute(
      `SELECT id, recipient, recipient_name AS recipientName, subject, text_body AS textBody, attempts
       FROM email_outbox
       WHERE sent_at IS NULL AND next_attempt_at <= CURRENT_TIMESTAMP
         AND (locked_until IS NULL OR locked_until < CURRENT_TIMESTAMP)
       ORDER BY id LIMIT ? FOR UPDATE`,
      [limit],
    )
    for (const message of messages) {
      await connection.execute(
        'UPDATE email_outbox SET locked_until = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 5 MINUTE), attempts = attempts + 1 WHERE id = ?',
        [message.id],
      )
      message.attempts = Number(message.attempts) + 1
    }
    await connection.commit()
    transactionOpen = false

    for (const message of messages) {
      try {
        await sendEmail({
          to: message.recipient,
          name: message.recipientName,
          subject: message.subject,
          text: message.textBody,
        })
        await pool.execute(
          'UPDATE email_outbox SET sent_at = CURRENT_TIMESTAMP, locked_until = NULL, last_error = NULL WHERE id = ?',
          [message.id],
        )
      } catch (error) {
        const retryAfterSeconds = Math.min(21_600, 60 * (2 ** Math.min(message.attempts - 1, 9)))
        await pool.execute(
          `UPDATE email_outbox SET locked_until = NULL,
             next_attempt_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ? SECOND),
             last_error = ? WHERE id = ?`,
          [retryAfterSeconds, String(error.message || 'Email delivery failed').slice(0, 500), message.id],
        )
        console.error(`Email outbox delivery failed for message ${message.id}: ${error.message}`)
      }
    }
  } catch (error) {
    if (connection && transactionOpen) await connection.rollback()
    throw error
  } finally {
    connection?.release()
    dispatching = false
  }
}

export async function queueOverdueReminders() {
  if (!isSmtpConfigured()) return { queued: 0, skipped: 'SMTP is not configured.' }

  const [loans] = await pool.query(
    `SELECT l.id AS loanId, l.quantity - l.returned_quantity - l.missed_quantity AS outstanding,
       DATE_FORMAT(l.due_date, '%Y-%m-%d') AS dueDate, b.title,
       m.name AS memberName, m.email
     FROM loans l
     JOIN books b ON b.id = l.book_id
     JOIN members m ON m.id = l.member_id
     WHERE l.due_date < CURRENT_DATE()
       AND l.quantity > l.returned_quantity + l.missed_quantity
       AND m.email IS NOT NULL AND m.email <> ''`,
  )
  const [[{ today }]] = await pool.query("SELECT DATE_FORMAT(CURRENT_DATE, '%Y-%m-%d') AS today")
  let queued = 0
  for (const loan of loans) {
    const [result] = await pool.execute(
      `INSERT IGNORE INTO email_outbox
        (event_key, event_type, recipient, recipient_name, subject, text_body)
       VALUES (?, 'overdue', ?, ?, ?, ?)`,
      [
        `overdue:${loan.loanId}:${today}`,
        loan.email,
        loan.memberName,
        `Overdue library book: ${loan.title}`.replace(/[\r\n]+/g, ' ').slice(0, 255),
        `Hello ${loan.memberName}, our records show that ${loan.outstanding} ${Number(loan.outstanding) === 1 ? 'copy' : 'copies'} of "${loan.title}" were due on ${loan.dueDate} and are still outstanding. Please return the book(s) to the library. If you have already returned them, please contact the librarian.`,
      ],
    )
    queued += result.affectedRows
  }
  return { queued }
}

export function startEmailWorker() {
  if (!transporter) {
    console.warn('Email delivery is disabled until valid SMTP settings are configured.')
    return
  }

  const run = async () => {
    const { queued } = await queueOverdueReminders()
    if (queued) console.info(`Queued ${queued} overdue loan reminder(s).`)
    await dispatchEmailOutbox()
  }
  const tick = () => run().catch((error) => console.error(`Email worker failed: ${error.message}`))
  tick()
  const timer = setInterval(tick, 15 * 60 * 1000)
  timer.unref()
}
