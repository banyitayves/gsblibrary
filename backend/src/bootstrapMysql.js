import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, readdir, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import mysql from 'mysql2/promise'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const serverHome = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'MySQL', 'MySQL Server 8.4')
const serverBinary = path.join(serverHome, 'bin', 'mysqld.exe')
const dataDirectory = path.join(
  process.env.LOCALAPPDATA || process.env.USERPROFILE,
  'LibraryFlow',
  'MySQL',
  'data',
)
const environmentFile = path.join(projectRoot, '.env')
const host = '127.0.0.1'
const port = 3306
const databaseName = 'library_management'
const appUser = 'library_app'
const randomSecret = () => randomBytes(48).toString('hex')
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const exists = (filename) => access(filename).then(() => true, () => false)

async function ensurePortIsFree() {
  await new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error('Port 3306 is already in use. Stop the other MySQL server before setting up this local instance.'))
      } else {
        reject(error)
      }
    })
    probe.listen(port, host, () => probe.close(resolve))
  })
}

function initializeDataDirectory() {
  const result = spawnSync(serverBinary, [
    '--initialize-insecure',
    `--basedir=${serverHome}`,
    `--datadir=${dataDirectory}`,
  ], { encoding: 'utf8', timeout: 180_000 })

  if (result.error || result.status !== 0) {
    throw new Error(`MySQL could not initialize its local data directory.\n${result.stderr || result.error?.message || ''}`)
  }
}

async function waitForServer(server) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`MySQL exited during startup (exit code ${server.exitCode}).`)
    }
    try {
      const connection = await mysql.createConnection({
        host,
        port,
        user: 'root',
        connectTimeout: 1000,
      })
      return connection
    } catch {
      await delay(500)
    }
  }
  throw new Error('MySQL did not start listening on 127.0.0.1:3306 within 30 seconds.')
}

async function stopServer(server, administrator) {
  try {
    await administrator.query('SHUTDOWN').catch((error) => {
      if (server.exitCode === null && !['ECONNRESET', 'PROTOCOL_CONNECTION_LOST'].includes(error.code)) {
        throw error
      }
    })
  } finally {
    if (server.exitCode === null) {
      await Promise.race([once(server, 'exit'), delay(10_000)])
    }
    if (server.exitCode === null) server.kill()
  }
}

async function bootstrap() {
  if (process.platform !== 'win32') {
    throw new Error('This local MySQL bootstrap is for Windows.')
  }
  if (!await exists(serverBinary)) {
    throw new Error('MySQL Server 8.4 is not installed. Install it with: winget install --id Oracle.MySQL --exact')
  }
  if (await exists(environmentFile)) {
    throw new Error('A root .env file already exists. Setup will not overwrite existing credentials.')
  }

  await ensurePortIsFree()
  await mkdir(path.dirname(dataDirectory), { recursive: true })
  const existingFiles = await readdir(dataDirectory).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  if (existingFiles.length > 0) {
    throw new Error(`The MySQL data directory is not empty: ${dataDirectory}. Setup will not overwrite existing data.`)
  }

  console.log('Initializing a private MySQL data directory for your Windows account...')
  initializeDataDirectory()

  const databasePassword = randomSecret()
  const jwtSecret = randomSecret()
  const rootPassword = randomSecret()
  const environment = [
    'PORT=3001',
    'CLIENT_URL=http://localhost:5173',
    `DB_HOST=${host}`,
    `DB_PORT=${port}`,
    `DB_USER=${appUser}`,
    `DB_PASSWORD=${databasePassword}`,
    `DB_NAME=${databaseName}`,
    `MYSQL_ROOT_PASSWORD=${rootPassword}`,
    `JWT_SECRET=${jwtSecret}`,
    '',
  ].join('\n')

  await writeFile(environmentFile, environment, { flag: 'wx', mode: 0o600 })

  const server = spawn(serverBinary, [
    '--console',
    `--basedir=${serverHome}`,
    `--datadir=${dataDirectory}`,
    `--port=${port}`,
    `--bind-address=${host}`,
    '--mysqlx=0',
    `--log-error=${path.join(dataDirectory, 'mysql.log')}`,
  ], { detached: false, stdio: 'ignore', windowsHide: true })
  server.on('error', () => {})

  let administrator
  try {
    console.log('Starting MySQL temporarily to create the database and app account...')
    administrator = await waitForServer(server)
    await administrator.query(`ALTER USER 'root'@'localhost' IDENTIFIED BY '${rootPassword}'`)
    await administrator.query(
      `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    )
    await administrator.query(
      `CREATE USER '${appUser}'@'${host}' IDENTIFIED BY '${databasePassword}'`,
    )
    await administrator.query(
      `GRANT ALL PRIVILEGES ON \`${databaseName}\`.* TO '${appUser}'@'${host}'`,
    )
    await administrator.end()
    administrator = undefined

    const setup = spawnSync(process.execPath, ['src/setupDatabase.js'], {
      cwd: path.join(projectRoot, 'backend'),
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (setup.stdout) process.stdout.write(setup.stdout)
    if (setup.stderr) process.stderr.write(setup.stderr)
    if (setup.error || setup.status !== 0) {
      throw new Error(`Could not create the application tables and sample data: ${setup.error?.message || `exit code ${setup.status}`}`)
    }

    administrator = await mysql.createConnection({
      host,
      port,
      user: 'root',
      password: rootPassword,
      database: 'mysql',
    })
    console.log(`MySQL is configured. Data is stored in ${dataDirectory}`)
    console.log('The local MySQL administrator password is stored in the ignored root .env file as MYSQL_ROOT_PASSWORD.')
  } catch (error) {
    if (!administrator && server.exitCode === null) {
      try {
        administrator = await mysql.createConnection({
          host,
          port,
          user: 'root',
          password: rootPassword,
          database: 'mysql',
          connectTimeout: 2000,
        })
      } catch {
        administrator = undefined
      }
    }
    throw error
  } finally {
    if (administrator) await stopServer(server, administrator)
    else if (server.exitCode === null) {
      server.kill()
      await Promise.race([once(server, 'exit'), delay(5000)])
    }
  }
}

try {
  await bootstrap()
  console.log('Database setup is complete.')
  console.log('Start MySQL with run_mysql.bat, then start the app with npm.cmd run dev.')
} catch (error) {
  console.error(`MySQL setup failed: ${error.message}`)
  process.exitCode = 1
}
