import { beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import type { Express } from 'express'
import { createApp } from '../src/app.js'

/**
 * Bodies the parser refuses are rejected before any route or database is
 * touched, so these run against a bare app (`null` web root keeps the static
 * handler out of the way) with no MongoDB instance.
 */
describe('Body parser rejections get a client error, not a 500', () => {
  let app: Express

  beforeAll(() => {
    app = createApp(null)
  })

  it('answers 413 when the JSON body exceeds the 100 kb limit', async () => {
    const res = await request(app)
      .post('/api/v1/announcements')
      .send({ title: 'oversize', body: 'x'.repeat(200_000) })

    expect(res.status).toBe(413)
    expect(res.body).toEqual({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'That request is too large. Send a smaller body.' },
    })
  })

  it('answers 400 when the body is not valid JSON', async () => {
    const res = await request(app)
      .post('/api/v1/announcements')
      .set('Content-Type', 'application/json')
      .send('{ "title": "')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('BAD_REQUEST')
  })

  it('answers 415 when the body arrives in an unsupported encoding', async () => {
    // The charset is taken from the Content-Type header and the body can only be
    // decoded into a handful of encodings; UTF-32 is not one of them, so the
    // request is refused before the JSON is parsed.
    const res = await request(app)
      .post('/api/v1/announcements')
      .set('Content-Type', 'application/json; charset=utf-32le')
      .send(Buffer.from(JSON.stringify({ title: 'any' }), 'utf8'))

    expect(res.status).toBe(415)
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('still accepts a comfortably small body', async () => {
    // Past the parser, into the app: with no session the auth layer answers,
    // which proves the limit check did not reject a normal request.
    const res = await request(app).post('/api/v1/announcements').send({ title: 'fine', body: 'ok' })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
})
