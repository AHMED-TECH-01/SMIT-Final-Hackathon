// Smoke check for the production same-origin build: one origin serves the UI,
// the API and the session cookie. Run against a server started with
// NODE_ENV=production: `node scripts/verify-prod.mjs [baseUrl]`
const base = process.argv[2] ?? 'http://localhost:4000'

function header(res, name) {
  return res.headers.get(name)
}

const shell = await fetch(`${base}/`)
const shellText = await shell.text()
console.log('GET /                    ->', shell.status, header(shell, 'content-type'))
console.log('   shell is the app     :', shellText.includes('<div id="root"'))
console.log('   cache-control        :', header(shell, 'cache-control'))
const csp = header(shell, 'content-security-policy')
console.log('   CSP present          :', csp ? 'yes' : 'no')
console.log('   upgrade-insecure-req :', csp?.includes('upgrade-insecure-requests') ? 'set' : 'absent')

const assetUrl = `${base}/assets/${(shellText.match(/\/assets\/(index-[\w-]+\.js)/) ?? [])[1]}`
const asset = await fetch(assetUrl)
console.log('GET built asset          ->', asset.status, '| cache-control:', header(asset, 'cache-control'))

const deepLink = await fetch(`${base}/attendance`)
console.log('GET /attendance (SPA)    ->', deepLink.status, header(deepLink, 'content-type'))

const apiMissing = await fetch(`${base}/api/v1/nope`)
console.log('GET unknown API route    ->', apiMissing.status, (await apiMissing.json()).error?.code)

const login = await fetch(`${base}/api/v1/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'admin@hcm.test', password: 'Password123' }),
})
const setCookie = header(login, 'set-cookie') ?? ''
const cookie = setCookie.split(';')[0]
console.log('POST /auth/login         ->', login.status)
console.log('   session cookie       :', setCookie.replace(/=[^;]*(?=;)/, '=…'))

const me = await fetch(`${base}/api/v1/auth/me`, { headers: { cookie } })
const meBody = await me.json()
console.log('GET /auth/me            ->', me.status, '| permissions:', meBody.data?.permissions?.length)

const board = await fetch(`${base}/api/v1/analytics/dashboard`, { headers: { cookie } })
console.log('GET /analytics/dashboard ->', board.status, '| workforce:', (await board.json()).data?.overview?.workforce?.total)
