import type { Request } from 'express'
import { unprocessable } from '../../lib/http-error.js'
import { EmployeeModel, type EmployeeDoc } from './employee.model.js'

/**
 * Self-service endpoints act on the signed-in user's own employee record.
 *
 * The employee is always resolved from the session, never from the request
 * body, so a caller can never act on somebody else's record by changing an id.
 */
export async function resolveOwnEmployee(req: Request): Promise<EmployeeDoc> {
  const employee = await EmployeeModel.findOne({ userId: req.user?.id })
  if (!employee) {
    throw unprocessable(
      'This account is not linked to an employee record, so it has no attendance or leave data.',
    )
  }
  return employee
}