import nodemailer from 'nodemailer'
import { config, isSmtpConfigured } from './config.js'

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
