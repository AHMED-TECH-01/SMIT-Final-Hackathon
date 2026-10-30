/**
 * Runs the whole demo with one command: `npm run demo`.
 *
 * Two database modes:
 *
 *   npm run demo                 In-memory MongoDB. Started, seeded and
 *                                discarded with the process. Needs no .env and
 *                                no installed database, so it is always safe.
 *   npm run demo -- --atlas      Uses server/.env, i.e. the configured persistent
 *                                MongoDB (a local mongod or an Atlas cluster).
 *                                Run `npm run seed -w api` first if it is
 *                                empty; the seed refuses to overwrite a
 *                                populated database.
 *
 * Either way the API serves :4000, Vite serves the UI on :5173 and proxies
 * /api to the API so the session cookie stays first-party. Ctrl+C stops both.
 */
import { spawn } from 'node:child_process'

const PERSISTENT = process.argv.includes('--atlas')
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

start('[api]', PERSISTENT ? `${npm} run dev -w api` : `${npm} run dev:mem -w api`)
start('[web]', `${npm} run dev -w web`)

process.stdout.write(
  PERSISTENT
    ? '\nHCM Lite demo starting against the database in server/.env (data is kept)\n  UI   http://localhost:5173\n  API  http://localhost:4000/api/v1/health\n\n'
    : '\nHCM Lite demo starting with an in-memory database (data is discarded on exit)\n  UI   http://localhost:5173\n  API  http://localhost:4000/api/v1/health\n\n',
)
