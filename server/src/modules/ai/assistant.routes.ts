import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../lib/async-handler.js'
import { ok } from '../../lib/response.js'
import { validate } from '../../middleware/validate.js'
import { requireAuth, requirePasswordChanged, requirePermission } from '../../middleware/auth.js'
import { EmployeeModel } from '../employees/employee.model.js'
import { resolveProvider, type AssistantFact } from './ai.provider.js'
import {
  SUGGESTIONS_BY_AUDIENCE,
  attendanceTodayTool,
  canSeeCompanyWide,
  employeeLookupTool,
  headcountTool,
  leaveBalanceTool,
  payrollSummaryTool,
  pendingApprovalsTool,
  type ToolResult,
} from './ai.tools.js'

/**
 * The assistant.
 *
 * The model is optional; the data is not. A question is mapped to a tool, the
 * tool queries MongoDB, and the answer is assembled from the result — so every
 * number here is the same number the dashboards show, and the assistant keeps
 * working with no API key, no network and no bill.
 */

const router = Router()

const gate = [requireAuth, requirePasswordChanged, requirePermission('ai.query')]

const chatBody = z.object({
  message: z.string().trim().min(2, 'Ask a question.').max(500),
})

type Intent =
  | 'headcount'
  | 'attendance_today'
  | 'leave_balance'
  | 'pending_approvals'
  | 'payroll'
  | 'employee_lookup'
  | 'help'

/** Intents that look at other people's records. */
const COMPANY_WIDE: readonly Intent[] = [
  'headcount',
  'attendance_today',
  'pending_approvals',
  'payroll',
  'employee_lookup',
]

const HELP_ANSWER = [
  'I can answer questions about the data in this system:',
  'headcount by department, who is absent today, what is waiting for approval,',
  'payroll totals, your own leave balance, and directory lookups.',
  'Try asking "how many employees do we have?" or "what is pending for approval?".',
].join(' ')

function detectIntent(question: string): Intent {
  const text = question.toLowerCase()

  if (/(how many (employees|staff|people)|headcount|workforce|total staff)/.test(text)) {
    return 'headcount'
  }
  if (/(absent|who.*(checked|signed) in|attendance (today|right now)|present today)/.test(text)) {
    return 'attendance_today'
  }
  if (/(leave|holiday|vacation).*(balance|left|remaining|available)|how many (leave|vacation) days/.test(text)) {
    return 'leave_balance'
  }
  if (/(pending|approval|waiting|queue)/.test(text)) return 'pending_approvals'
  if (/(payroll|salary|salaries|payslip|pay slip|cost)/.test(text)) return 'payroll'
  if (/(find|look ?up|who is|search|directory)/.test(text)) return 'employee_lookup'

  return 'help'
}

/** Whatever is left of the question once the trigger words are removed. */
function extractName(question: string): string {
  const cleaned = question
    .replace(/[?.!]/g, ' ')
    .replace(
      /\b(please|can you|could you|show me|tell me|do we have|in the directory|details of|look up|lookup|find|search for|search|who is|about|the employee|employee|staff member)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned.length >= 2 ? cleaned : question.trim()
}

function asFact(tool: ToolResult): AssistantFact {
  return {
    name: tool.name,
    label: tool.label,
    summary: tool.summary,
    data: tool.data,
  }
}

router.post(
  '/chat',
  gate,
  validate({ body: chatBody }),
  asyncHandler(async (req, res) => {
    const { message } = req.body as z.infer<typeof chatBody>
    const audience = req.user!.role
    const intent = detectIntent(message)
    const provider = resolveProvider()
    const suggestions = SUGGESTIONS_BY_AUDIENCE[audience]

    if (COMPANY_WIDE.includes(intent) && !canSeeCompanyWide(req)) {
      ok(res, {
        answer:
          'Company-wide figures are only available to HR and admin accounts. I can still tell you your own leave balance.',
        intent,
        tools: [],
        provider: provider.name,
        suggestions,
      })
      return
    }

    let tool: ToolResult | null = null

    switch (intent) {
      case 'headcount':
        tool = await headcountTool()
        break
      case 'attendance_today':
        tool = await attendanceTodayTool()
        break
      case 'pending_approvals':
        tool = await pendingApprovalsTool()
        break
      case 'payroll':
        tool = await payrollSummaryTool()
        break
      case 'employee_lookup':
        tool = await employeeLookupTool(extractName(message))
        break
      case 'leave_balance': {
        // Accounts without a linked employee record have no ledger to read.
        const employee = await EmployeeModel.findOne({ userId: req.user!.id }).select('_id')
        if (!employee) {
          ok(res, {
            answer:
              'Your account is not linked to an employee record yet, so there is no leave balance to show. Ask HR to link it for you.',
            intent,
            tools: [],
            provider: provider.name,
            suggestions,
          })
          return
        }
        tool = await leaveBalanceTool(req)
        break
      }
      default:
        break
    }

    if (!tool) {
      ok(res, {
        answer: HELP_ANSWER,
        intent,
        tools: [],
        provider: provider.name,
        suggestions,
      })
      return
    }

    const answer = await provider.answer({
      question: message,
      fallback: tool.answer,
      facts: [asFact(tool)],
      audience,
    })

    ok(res, {
      answer,
      intent,
      tools: [asFact(tool)],
      provider: provider.name,
      suggestions,
    })
  }),
)

/** Sample questions, so the UI can offer prompts instead of a blank box. */
router.get(
  '/suggestions',
  gate,
  asyncHandler(async (req, res) => {
    ok(res, { suggestions: SUGGESTIONS_BY_AUDIENCE[req.user!.role] })
  }),
)

export default router