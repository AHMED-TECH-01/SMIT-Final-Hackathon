import { dateKeyToUtcMidnight } from '../../lib/dates.js'
import { LeaveTypeModel } from '../organization/leave-type.model.js'
import { BALANCE_CONSUMING, LeaveRequestModel } from './leave.model.js'

export interface LeaveBalance {
  leaveTypeId: string
  name: string
  code: string
  entitled: number
  used: number
  pending: number
  /** Entitled minus approved days. */
  remaining: number
  /** Entitled minus approved *and* pending days — what a new request may consume. */
  available: number
}

/** Balances are always computed for one calendar year of the company time zone. */
export function leaveYear(date: Date): number {
  return date.getUTCFullYear()
}

export function yearWindow(year: number): { from: Date; to: Date } {
  return {
    from: dateKeyToUtcMidnight(`${year}-01-01`),
    to: dateKeyToUtcMidnight(`${year}-12-31`),
  }
}

/**
 * Derives a balance rather than storing it: the request ledger is the single
 * source of truth, so a cancellation or rejection can never leave a stale counter.
 */
export async function balancesFor(employeeId: string, year: number): Promise<LeaveBalance[]> {
  const { from, to } = yearWindow(year)

  const [leaveTypes, requests] = await Promise.all([
    LeaveTypeModel.find({ isActive: { $ne: false } }).sort({ name: 1 }),
    LeaveRequestModel.find({
      employeeId,
      status: { $in: ['approved', 'pending'] },
      startDate: { $gte: from, $lte: to },
    }).select('leaveTypeId days status'),
  ])

  return leaveTypes.map((leaveType) => {
    const id = String(leaveType._id)
    let used = 0
    let pending = 0

    for (const request of requests) {
      if (String(request.leaveTypeId) !== id) continue
      if ((BALANCE_CONSUMING as readonly string[]).includes(request.status)) used += request.days
      else if (request.status === 'pending') pending += request.days
    }

    return {
      leaveTypeId: id,
      name: leaveType.name,
      code: leaveType.code,
      entitled: leaveType.annualQuota,
      used,
      pending,
      remaining: Math.max(0, leaveType.annualQuota - used),
      available: Math.max(0, leaveType.annualQuota - used - pending),
    }
  })
}