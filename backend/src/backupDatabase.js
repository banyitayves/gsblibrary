import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { appendFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const mysqlHome = path.join(
  process.env.ProgramFiles || 'C:\\Program Files',
  'MySQL',
  'MySQL Server 8.4',
)
const mysqlBin = path.join(mysqlHome, 'bin')
const mysqlData = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'LibraryFlow',
  'MySQL',
  'data',
)
const backupDirectory = path.resolve(
  process.env.BACKUP_DIR
    || path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'LibraryFlow',
      'Backups',
    ),
)
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30)
const isLocalDatabase = ['localhost', '127.0.0.1', '::1'].includes(config.database.host)

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`
  process.stdout.write(line)
  return appendFile(path.join(backupDirectory, 'backup.log'), line, 'utf8')
}

function runCommand(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        reject(new Error(`${path.basename(command)} exited with code ${code}: ${(stderr || stdout).trim()}`))
      }
    })
  })
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (connected) => {
      socket.destroy()
      resolve(connected)
    }
    socket.setTimeout(1000, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}

async function waitForDatabase(child, getSpawnError) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (getSpawnError()) {
      throw new Error(`Could not start mysqld.exe: ${getSpawnError().message}`)
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`MySQL stopped during startup. Check ${path.join(mysqlData, 'mysql.log')}.`)
    }
    if (await canConnect(config.database.host, config.database.port)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`MySQL did not start on ${config.database.host}:${config.database.port}. Check ${path.join(mysqlData, 'mysql.log')}.`)
}

async function startLocalDatabaseIfNeeded() {
  if (await canConnect(config.database.host, config.database.port)) return null
  if (!isLocalDatabase) {
    throw new Error(`Database server ${config.database.host}:${config.database.port} is not reachable.`)
  }
  if (!process.env.MYSQL_ROOT_PASSWORD) {
    throw new Error('MYSQL_ROOT_PASSWORD is required to start and cleanly stop the local MySQL server for an automatic backup.')
  }
  if (!(await exists(path.join(mysqlBin, 'mysqld.exe'))) || !(await exists(path.join(mysqlData, 'auto.cnf')))) {
    throw new Error('The local MySQL server or initialized data directory was not found.')
  }

  const child = spawn(
    path.join(mysqlBin, 'mysqld.exe'),
    [
      '--console',
      `--basedir=${mysqlHome}`,
      `--datadir=${mysqlData}`,
      `--port=${config.database.port}`,
      '--bind-address=127.0.0.1',
      '--mysqlx=0',
      `--log-error=${path.join(mysqlData, 'mysql.log')}`,
    ],
    { windowsHide: true, stdio: 'ignore' },
  )
  let spawnError
  child.once('error', (error) => { spawnError = error })
  try {
    await waitForDatabase(child, () => spawnError)
  } catch (error) {
    if (!spawnError && child.exitCode === null && child.signalCode === null) {
      try {
        await stopStartedDatabase(child)
      } catch (shutdownError) {
        throw new AggregateError([error, shutdownError], 'MySQL startup failed and the temporary server could not be stopped cleanly.')
      }
    }
    throw error
  }
  return child
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function stopStartedDatabase(child) {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exitPromise = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : once(child, 'exit')
  const env = { ...process.env, MYSQL_PWD: process.env.MYSQL_ROOT_PASSWORD }
  await runCommand(
    path.join(mysqlBin, 'mysqladmin.exe'),
    [
      '--host=127.0.0.1',
      `--port=${config.database.port}`,
      '--user=root',
      'shutdown',
    ],
    env,
  )
  let timeout
  try {
    await Promise.race([
      exitPromise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('MySQL did not shut down after the backup; it has been left running.')),
          15_000,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

async function removeExpiredBackups() {
  const prefix = `${config.database.name}-`
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const files = await readdir(backupDirectory, { withFileTypes: true })
  for (const file of files) {
    if (!file.isFile() || !new RegExp(`^${prefix}\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}Z\\.sql$`).test(file.name)) {
      continue
    }
    const filePath = path.join(backupDirectory, file.name)
    const details = await stat(filePath)
    if (details.mtimeMs < cutoff) {
      await rm(filePath)
      await log(`Removed expired backup ${file.name}.`)
    }
  }
}

async function createBackup() {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('BACKUP_RETENTION_DAYS must be a positive whole number.')
  }
  await mkdir(backupDirectory, { recursive: true })

  const logFile = path.join(backupDirectory, 'backup.log')
  const caFile = path.join(backupDirectory, `.ca-${process.pid}.pem`)
  let temporaryDump
  let startedDatabase
  let failure

  try {
    const dumpPath = path.join(mysqlBin, 'mysqldump.exe')
    if (!(await exists(dumpPath))) throw new Error(`mysqldump.exe was not found at ${dumpPath}.`)

    if (process.env.DB_SSL === 'true' && process.env.DB_SSL_CA) {
      await writeFile(caFile, process.env.DB_SSL_CA.replace(/\\n/g, '\n'), { encoding: 'utf8', flag: 'wx' })
    }

    startedDatabase = await startLocalDatabaseIfNeeded()
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}/, '')
    const backupName = `${config.database.name}-${timestamp}.sql`
    const backupPath = path.join(backupDirectory, backupName)
    temporaryDump = `${backupPath}.partial`
    const args = [
      '--single-transaction',
      '--routines',
      '--events',
      '--triggers',
      '--hex-blob',
      '--no-tablespaces',
      '--default-character-set=utf8mb4',
      `--host=${config.database.host}`,
      `--port=${config.database.port}`,
      `--user=${config.database.user}`,
      `--result-file=${temporaryDump}`,
    ]
    if (process.env.DB_SSL === 'true') {
      args.push('--ssl-mode=VERIFY_IDENTITY')
      if (await exists(caFile)) args.push(`--ssl-ca=${caFile}`)
    }
    args.push(config.database.name)

    const env = process.env.DB_PASSWORD
      ? { ...process.env, MYSQL_PWD: process.env.DB_PASSWORD }
      : process.env
    await log(`Starting backup of ${config.database.name} to ${backupPath}.`)
    await runCommand(dumpPath, args, env)

    const dumpDetails = await stat(temporaryDump)
    if (dumpDetails.size === 0) throw new Error('mysqldump created an empty file; keeping it as a failed partial and not rotating backups.')
    await rename(temporaryDump, backupPath)
    temporaryDump = null
    await log(`Backup completed: ${backupName} (${dumpDetails.size} bytes).`)
    await removeExpiredBackups()
  } catch (error) {
    failure = error
  }

  if (startedDatabase) {
    try {
      await stopStartedDatabase(startedDatabase)
      await log('Stopped the temporary MySQL server.')
    } catch (error) {
      failure = failure
        ? new AggregateError([failure, error], 'Backup failed and the temporary MySQL server could not be stopped cleanly.')
        : error
    }
  }

  if (await exists(caFile)) await rm(caFile)
  if (temporaryDump && await exists(temporaryDump)) await rm(temporaryDump)
  if (failure) {
    await log(`Backup failed: ${failure.message}`)
    throw failure
  }

  return log(`Backup finished. Logs: ${logFile}`)
}

createBackup().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`)
  process.exitCode = 1
})
