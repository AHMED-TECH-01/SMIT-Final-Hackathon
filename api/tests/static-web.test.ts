import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'

const API_PREFIX = '/api/v1'

/**
 * A stand-in for `web/dist`: a fingerprinted asset, a plain file, and the shell
 * that references them. Nothing here depends on the real build output, so the
 * suite does not have to run `vite build` first.
 */
function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'hcm-web-root-'))
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>HCM Lite</title>')
  writeFileSync(join(root, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
  writeFileSync(join(root, 'assets/app-abcd.js'), 'console.log("shell")')
  return root
}

describe('Serving the frontend from the API (one origin in production)', () => {
  let root: string
  let app: Express

  beforeAll(() => {
    root = makeFixture()
    app = createApp(root)
  })
  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('serves the shell for the root path without caching it', async () => {
    const res = await request(app).get('/')

    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>HCM Lite</title>')
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['cache-control']).toBe('no-cache')
  })

  it('serves a client-side route as the shell, so deep links survive a refresh', async () => {
    const res = await request(app).get('/attendance/12')

    expect(res.status).toBe(200)
    expect(res.text).toContain('<title>HCM Lite</title>')
  })

  it('serves built assets and caches them for a year', async () => {
    const res = await request(app).get('/assets/app-abcd.js')

    expect(res.status).toBe(200)
    expect(res.text).toContain('console.log')
    expect(res.headers['cache-control']).toContain('max-age=31536000')
  })

  it('leaves API routes to the API instead of answering them with HTML', async () => {
    const res = await request(app).get(`${API_PREFIX}/definitely-not-a-route`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('does not intercept a POST to an unknown API path', async () => {
    const res = await request(app).post(`${API_PREFIX}/definitely-not-a-route`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('serves JSON only when there is no frontend build to find', async () => {
    const apiOnly = createApp(null)

    const res = await request(apiOnly).get('/')

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('stays out of the way when the app is created under test', async () => {
    // `createApp` must not start serving HTML merely because a build exists on
    // disk; test assertions are about JSON.
    const res = await request(createApp()).get('/')

    expect(res.status).toBe(404)
  })
})
