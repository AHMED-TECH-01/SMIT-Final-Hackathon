import { describe, expect, it } from 'vitest'
import { inferNodeEnv } from '../src/config/env.js'
import { FixedWindowLimiter } from '../src/lib/fixed-window-limiter.js'
import { PERMISSIONS, can, isRole, permissionsFor } from '../src/modules/auth/permissions.js'

describe('FixedWindowLimiter', () => {
  function harness(max = 3, windowMs = 60_000) {
    let clock = 1_000_000
    return {
      limiter: new FixedWindowLimiter(max, windowMs, () => clock),
      advance: (ms: number) => {
        clock += ms
      },
    }
  }

  it('allows exactly max attempts inside the window', () => {
    const { limiter } = harness(3)
    expect(limiter.hit('ip')).toMatchObject({ limited: false, remaining: 2 })
    expect(limiter.hit('ip')).toMatchObject({ limited: false, remaining: 1 })
    expect(limiter.hit('ip')).toMatchObject({ limited: false, remaining: 0 })
  })

  it('throttles the attempt after max', () => {
    const { limiter } = harness(2)
    limiter.hit('ip')
    limiter.hit('ip')
    expect(limiter.hit('ip')).toMatchObject({ limited: true, remaining: 0 })
  })

  it('keeps separate keys independent', () => {
    const { limiter } = harness(1)
    expect(limiter.hit('ip:a').limited).toBe(false)
    expect(limiter.hit('ip:a').limited).toBe(true)
    expect(limiter.hit('ip:b').limited).toBe(false)
  })

  it('reports a shrinking retryAfter', () => {
    const { limiter, advance } = harness(1, 60_000)
    expect(limiter.hit('ip').retryAfter).toBe(60)
    advance(45_000)
    expect(limiter.hit('ip').retryAfter).toBe(15)
  })

  it('starts a fresh window once the old one expires', () => {
    const { limiter, advance } = harness(1, 60_000)
    limiter.hit('ip')
    expect(limiter.hit('ip').limited).toBe(true)
    advance(60_000)
    expect(limiter.hit('ip')).toMatchObject({ limited: false, remaining: 0 })
  })

  it('reset clears a single key', () => {
    const { limiter } = harness(1)
    limiter.hit('ip')
    limiter.reset('ip')
    expect(limiter.hit('ip').limited).toBe(false)
  })

  it('sweep drops only expired windows', () => {
    const { limiter, advance } = harness(1, 60_000)
    limiter.hit('old')
    advance(30_000)
    limiter.hit('fresh')
    advance(30_000)
    limiter.sweep()
    expect(limiter.hit('old').limited).toBe(false)
    expect(limiter.hit('fresh').limited).toBe(true)
  })
})

describe('permission matrix', () => {
  it('grants the admin every permission', () => {
    expect(permissionsFor('admin')).toHaveLength(PERMISSIONS.length)
    expect(can('admin', 'audit.read')).toBe(true)
    expect(can('admin', 'settings.manage')).toBe(true)
  })

  it('restricts HR to operational duties', () => {
    expect(can('hr', 'employee.read')).toBe(true)
    expect(can('hr', 'leave.approve')).toBe(true)
    expect(can('hr', 'user.read')).toBe(false)
    expect(can('hr', 'audit.read')).toBe(false)
    expect(can('hr', 'settings.manage')).toBe(false)
    expect(can('hr', 'payroll.approve')).toBe(false)
  })

  it('limits employees to their own data', () => {
    expect(can('employee', 'leave.apply')).toBe(true)
    expect(can('employee', 'payroll.read.own')).toBe(true)
    expect(can('employee', 'employee.read')).toBe(false)
    expect(can('employee', 'leave.approve')).toBe(false)
    expect(can('employee', 'analytics.read')).toBe(false)
  })

  it('denies unknown roles by default', () => {
    expect(permissionsFor('ghost' as never)).toEqual([])
    expect(can('ghost' as never, 'announcement.read')).toBe(false)
  })

  it('recognises only the three declared roles', () => {
    expect(isRole('admin')).toBe(true)
    expect(isRole('hr')).toBe(true)
    expect(isRole('employee')).toBe(true)
    expect(isRole('root')).toBe(false)
    expect(isRole(undefined)).toBe(false)
    expect(isRole(42)).toBe(false)
  })
})

describe('inferNodeEnv', () => {
  it('treats a Vercel production function as production', () => {
    expect(inferNodeEnv({ VERCEL_ENV: 'production' })).toBe('production')
  })

  it('never overrides an explicit NODE_ENV', () => {
    expect(inferNodeEnv({ NODE_ENV: 'development', VERCEL_ENV: 'production' })).toBeUndefined()
    expect(inferNodeEnv({ NODE_ENV: 'test', VERCEL_ENV: 'production' })).toBeUndefined()
  })

  it('leaves preview and unrelated hosts to the default', () => {
    expect(inferNodeEnv({ VERCEL_ENV: 'preview' })).toBeUndefined()
    expect(inferNodeEnv({})).toBeUndefined()
  })
})
