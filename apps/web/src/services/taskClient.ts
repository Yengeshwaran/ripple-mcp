export type TaskStatus = 'open' | 'in_progress' | 'done'

// Provisional UI model; align it with the shared contract before real integration.
export type Task = {
  id: string
  title: string
  description?: string
  assignee?: string
  deadline?: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
}

export type CreateTaskInput = Pick<Task, 'title'> &
  Partial<Pick<Task, 'description' | 'assignee' | 'deadline'>>

export type TaskFilters = Partial<Pick<Task, 'status' | 'assignee'>>

export type TaskToolCall = {
  id: string
  name: string
  input: Record<string, unknown>
  output: string
  succeeded: boolean
  calledAt: string
}

// UI components depend on this interface, not on a backend transport or mock store.
export interface TaskClient {
  createTask(input: CreateTaskInput): Promise<Task>
  listTasks(filters?: TaskFilters): Promise<Task[]>
  assignTask(taskId: string, assignee: string): Promise<Task>
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<Task>
}
