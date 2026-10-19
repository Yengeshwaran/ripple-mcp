import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CreateTaskInput, Task, TaskClient, TaskFilters, TaskStatus, TaskToolCall } from './taskClient'

type ToolArguments = Record<string, unknown>

type ToolResult = {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

const taskStatuses = ['open', 'in_progress', 'done'] as const
const isoDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/
const useTaskStatus = (status: string): status is TaskStatus =>
  taskStatuses.some((validStatus) => validStatus === status)

function isIsoDateTime(value: string): boolean {
  return isoDateTimePattern.test(value) && Number.isFinite(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`MCP task response has an invalid "${key}" field.`)
  }
  return value
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`MCP task response has an invalid "${key}" field.`)
  }
  return value
}

function isoTimestamp(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key)
  if (!isIsoDateTime(value)) {
    throw new Error(`MCP task response has an invalid ISO date/time in "${key}".`)
  }
  return value
}

function parseTask(value: unknown): Task {
  if (!isRecord(value)) {
    throw new Error('MCP task response is not an object.')
  }

  const status = requiredString(value, 'status')
  if (!useTaskStatus(status)) {
    throw new Error(`MCP task response has an unknown status: ${status}`)
  }

  const deadline = optionalString(value, 'deadline')
  if (deadline !== undefined && !isIsoDateTime(deadline)) {
    throw new Error('MCP task response has an invalid ISO date/time in "deadline".')
  }

  const description = optionalString(value, 'description')
  const assignee = optionalString(value, 'assignee')

  return {
    id: requiredString(value, 'id'),
    title: requiredString(value, 'title'),
    ...(description !== undefined && { description }),
    ...(assignee !== undefined && { assignee }),
    ...(deadline !== undefined && { deadline }),
    status,
    createdAt: isoTimestamp(value, 'createdAt'),
    updatedAt: isoTimestamp(value, 'updatedAt'),
  }
}

function responseText(result: ToolResult): string {
  return result.content
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class McpTaskClient implements TaskClient {
  private clientPromise: Promise<Client> | undefined
  private readonly onToolCall: (toolCall: TaskToolCall) => void
  private readonly endpoint: string

  constructor(
    onToolCall: (toolCall: TaskToolCall) => void = () => {},
    endpoint = import.meta.env.VITE_MCP_URL || '/mcp',
  ) {
    this.onToolCall = onToolCall
    this.endpoint = endpoint
  }

  private async getClient(): Promise<Client> {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
          import('@modelcontextprotocol/sdk/client/index.js'),
          import('@modelcontextprotocol/sdk/client/streamableHttp.js'),
        ])
        const client = new Client({ name: 'commitment-radar-web', version: '0.1.0' })
        const baseUrl = typeof window === 'undefined' ? 'http://localhost:5173/' : window.location.href
        const transport = new StreamableHTTPClientTransport(new URL(this.endpoint, baseUrl))
        await client.connect(transport)
        return client
      })()
    }

    try {
      return await this.clientPromise
    } catch (error) {
      this.clientPromise = undefined
      throw error
    }
  }

  private async callTaskTool<T>(
    name: string,
    input: ToolArguments,
    parseOutput: (value: unknown) => T,
  ): Promise<T> {
    let output = ''
    try {
      const client = await this.getClient()
      const result = await client.callTool({ name, arguments: input }) as ToolResult
      output = responseText(result)
      if (result.isError) {
        throw new Error(output || `MCP tool "${name}" failed.`)
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(output)
      } catch {
        throw new Error(`MCP tool "${name}" returned invalid JSON.`)
      }

      const value = parseOutput(parsed)
      this.onToolCall({
        id: crypto.randomUUID(),
        name,
        input,
        output,
        succeeded: true,
        calledAt: new Date().toISOString(),
      })
      return value
    } catch (error) {
      const message = errorMessage(error)
      this.onToolCall({
        id: crypto.randomUUID(),
        name,
        input,
        output: output || message,
        succeeded: false,
        calledAt: new Date().toISOString(),
      })
      throw new Error(message)
    }
  }

  createTask(input: CreateTaskInput): Promise<Task> {
    const title = input.title.trim()
    if (!title) throw new Error('Task title is required.')

    const args: ToolArguments = { title }
    if (input.description?.trim()) args.description = input.description.trim()
    if (input.assignee?.trim()) args.assignee = input.assignee.trim()
    if (input.deadline !== undefined) {
      const timestamp = Date.parse(input.deadline)
      if (!Number.isFinite(timestamp)) {
        throw new Error('Deadline must be a valid ISO date/time.')
      }
      args.deadline = new Date(timestamp).toISOString()
    }

    return this.callTaskTool('create_task', args, parseTask)
  }

  listTasks(filters: TaskFilters = {}): Promise<Task[]> {
    const args: ToolArguments = {}
    if (filters.status !== undefined) args.status = filters.status
    if (filters.assignee?.trim()) args.assignee = filters.assignee.trim()

    return this.callTaskTool('list_tasks', args, (value) => {
      if (!Array.isArray(value)) {
        throw new Error('MCP list_tasks response is not an array.')
      }
      return value.map(parseTask)
    })
  }

  assignTask(taskId: string, assignee: string): Promise<Task> {
    const normalizedTaskId = taskId.trim()
    const normalizedAssignee = assignee.trim()
    if (!normalizedTaskId) throw new Error('Task id is required.')
    if (!normalizedAssignee) throw new Error('Assignee is required.')

    return this.callTaskTool(
      'assign_task',
      { task_id: normalizedTaskId, assignee: normalizedAssignee },
      parseTask,
    )
  }
}
