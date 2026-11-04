/**
 * Runs the whole demo with one command: `npm run demo`.
 *
 * Three database modes:
 *
 *   npm run demo                 In-memory MongoDB. Started, seeded and
 *                                discarded with the process. Needs no .env and
 *                                no installed database, so it is always safe.
 *   npm run demo -- --atlas      Uses server/.env, i.e. the configured persistent
 *                                MongoDB (a local mongod or an Atlas cluster).
 *                                Run `npm run seed -w api` first if it is
 *                                empty; the seed refuses to overwrite a
 *                                populated database.
 *   npm run demo -- --empty      In-memory MongoDB with no seed. The company
 *                                record is missing on purpose, so `/` shows the
 *                                landing page and `/signup` can register the
 *                                first administrator. Restarting discards it.
 *
 * Either way the API serves :4000, Vite serves the UI on :5173 and proxies
 * /api to the API so the session cookie stays first-party. Ctrl+C stops both.
 */
import { spawn } from 'node:child_process'

const PERSISTENT = process.argv.includes('--atlas')
const EMPTY = process.argv.includes('--empty')
const IS_WINDOWS = process.platform === 'win32'
const npm = IS_WINDOWS ? 'npm.cmd' : 'npm'
const children = []

function start(label, command) {
  const child = spawn(command, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)

  const relay = (stream, write) => {
    stream.setEncoding('utf8')
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) write(`${label} ${line}`)
    })
  }

  relay(child.stdout, (line) => process.stdout.write(`${line}\n`))
  relay(child.stderr, (line) => process.stderr.write(`${line}\n`))
  child.on('exit', (code) => {
    process.stdout.write(`${label} exited with code ${code}\n`)
    stopAll()
  })
  return child
}

let stopping = false
function stopAll() {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.killed || child.exitCode !== null) continue
    // `shell: true` means the real work happens in a grandchild process.
    if (IS_WINDOWS) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    else child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(0), 500).unref()
}

process.on('SIGINT', stopAll)
process.on('SIGTERM', stopAll)

const apiCommand = PERSISTENT
  ? `${npm} run dev -w api`
  : EMPTY
    ? `${npm} run dev:empty -w api`
    : `${npm} run dev:mem -w api`

start('[api]', apiCommand)
start('[web]', `${npm} run dev -w web`)

const banner = PERSISTENT
  ? '\nHCM Lite demo starting against the database in server/.env (data is kept)\n  UI   http://localhost:5173\n  API  http://localhost:4000/api/v1/health\n\n'
  : EMPTY
    ? '\nHCM Lite demo starting with an empty in-memory database — /signup is open\n  UI    http://localhost:5173\n  API   http://localhost:4000/api/v1/health\n  Check `npm run verify:signup` in another terminal to walk the sign-up flow end to end\n\n'
    : '\nHCM Lite demo starting with a seeded in-memory database (data is discarded on exit)\n  UI   http://localhost:5173\n  API  http://localhost:4000/api/v1/health\n\n'

process.stdout.write(banner)
