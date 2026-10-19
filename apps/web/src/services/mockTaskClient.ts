import type { CreateTaskInput, Task, TaskClient, TaskFilters } from './taskClient'

// Keep demo tasks in the mock adapter so the UI has no direct dependency on fixtures.
const sampleTasks: Task[] = [
  {
    id: 'task-1',
    title: 'Prepare the Alexa+ demo recording',
    assignee: 'Maya Chen',
    deadline: '2026-10-23T12:00:00-07:00',
    status: 'open',
    createdAt: '2026-10-19T09:00:00.000Z',
    updatedAt: '2026-10-19T09:00:00.000Z',
  },
  {
    id: 'task-2',
    title: 'Submit the Commitment Radar demo',
    assignee: 'Maya Chen',
    deadline: '2026-10-23T12:00:00-07:00',
    status: 'open',
    createdAt: '2026-10-19T09:05:00.000Z',
    updatedAt: '2026-10-19T09:05:00.000Z',
  },
  {
    id: 'task-3',
    title: 'Review the meeting transcript',
    assignee: 'Jonah Lee',
    deadline: '2026-10-23T12:00:00-07:00',
    status: 'in_progress',
    createdAt: '2026-10-19T09:10:00.000Z',
    updatedAt: '2026-10-19T09:10:00.000Z',
  },
]

function copyTask(task: Task): Task {
  return { ...task }
}

export class MockTaskClient implements TaskClient {
  private tasks = sampleTasks.map(copyTask)

  async createTask(input: CreateTaskInput): Promise<Task> {
    const title = input.title.trim()
    if (!title) {
      throw new Error('Task title is required.')
    }

    const now = new Date().toISOString()
    const task: Task = {
      id: `task-${crypto.randomUUID()}`,
      title,
      ...(input.description !== undefined && { description: input.description }),
      ...(input.assignee !== undefined && { assignee: input.assignee }),
      ...(input.deadline !== undefined && { deadline: input.deadline }),
      status: 'open',
      createdAt: now,
      updatedAt: now,
    }

    this.tasks = [...this.tasks, task]
    return copyTask(task)
  }

  async listTasks(filters: TaskFilters = {}): Promise<Task[]> {
    return this.tasks
      .filter((task) => filters.status === undefined || task.status === filters.status)
      .filter((task) => filters.assignee === undefined || task.assignee === filters.assignee)
      .map(copyTask)
  }

  async assignTask(taskId: string, assignee: string): Promise<Task> {
    const normalizedAssignee = assignee.trim()
    if (!normalizedAssignee) {
      throw new Error('Assignee is required.')
    }

    const taskIndex = this.tasks.findIndex((task) => task.id === taskId)
    if (taskIndex === -1) {
      throw new Error(`Task not found: ${taskId}`)
    }

    const assignedTask: Task = {
      ...this.tasks[taskIndex],
      assignee: normalizedAssignee,
      updatedAt: new Date().toISOString(),
    }
    this.tasks = this.tasks.map((task, index) =>
      index === taskIndex ? assignedTask : task,
    )

    return copyTask(assignedTask)
  }
}
