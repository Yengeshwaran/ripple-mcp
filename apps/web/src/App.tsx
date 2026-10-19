import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import './App.css'
import { McpTaskClient } from './services/mcpTaskClient'
import { MockTaskClient } from './services/mockTaskClient'
import type { CreateTaskInput, Task, TaskClient, TaskToolCall } from './services/taskClient'

const useMockTaskClient = import.meta.env.VITE_USE_MOCK_TASK_CLIENT === 'true'

function formatDeadline(deadline: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(deadline))
}

function findConflictingTaskIds(tasks: Task[]): Set<string> {
  const tasksByOwnerAndDeadline = new Map<string, string[]>()

  for (const task of tasks) {
    if (!task.assignee || !task.deadline) continue
    const key = `${task.assignee}\u0000${Date.parse(task.deadline)}`
    tasksByOwnerAndDeadline.set(key, [...(tasksByOwnerAndDeadline.get(key) ?? []), task.id])
  }

  return new Set(
    [...tasksByOwnerAndDeadline.values()]
      .filter((taskIds) => taskIds.length > 1)
      .flat(),
  )
}

function App() {
  const [toolCalls, setToolCalls] = useState<TaskToolCall[]>([])
  const [taskClient] = useState<TaskClient>(() =>
    useMockTaskClient
      ? new MockTaskClient()
      : new McpTaskClient((toolCall) =>
          setToolCalls((current) => [toolCall, ...current].slice(0, 20)),
        ),
  )
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState(
    useMockTaskClient ? 'Mock adapter' : 'Connecting to MCP',
  )
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [deadline, setDeadline] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [assignees, setAssignees] = useState<Record<string, string>>({})
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)
  const initialLoadStarted = useRef(false)

  // Read tasks from the selected adapter and surface connection failures directly.
  const loadTasks = useCallback(async (showLoading = false) => {
    if (showLoading) setIsLoadingTasks(true)
    setTaskLoadError(null)
    try {
      const loadedTasks = await taskClient.listTasks()
      setTasks(loadedTasks)
      setConnectionStatus(useMockTaskClient ? 'Mock adapter' : 'MCP connected')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load tasks.'
      setTaskLoadError(message)
      setConnectionStatus(useMockTaskClient ? 'Mock adapter' : 'MCP unavailable')
    } finally {
      setIsLoadingTasks(false)
    }
  }, [taskClient])

  useEffect(() => {
    if (initialLoadStarted.current) return
    initialLoadStarted.current = true
    void loadTasks(true)
  }, [loadTasks])

  const orderedTasks = [...tasks].sort((first, second) =>
    (first.deadline ?? '').localeCompare(second.deadline ?? ''),
  )
  const conflictingTaskIds = findConflictingTaskIds(orderedTasks)

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateError(null)

    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      setCreateError('Task title is required.')
      return
    }

    let isoDeadline: string | undefined
    if (deadline) {
      const date = new Date(deadline)
      if (!Number.isFinite(date.getTime())) {
        setCreateError('Enter a valid deadline.')
        return
      }
      isoDeadline = date.toISOString()
    }

    const input: CreateTaskInput = {
      title: normalizedTitle,
      ...(description.trim() && { description: description.trim() }),
      ...(newAssignee.trim() && { assignee: newAssignee.trim() }),
      ...(isoDeadline && { deadline: isoDeadline }),
    }

    setIsCreating(true)
    try {
      await taskClient.createTask(input)
      setTitle('')
      setDescription('')
      setNewAssignee('')
      setDeadline('')
      await loadTasks()
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create task.')
      setConnectionStatus(useMockTaskClient ? 'Mock adapter' : 'MCP unavailable')
    } finally {
      setIsCreating(false)
    }
  }

  async function handleAssignTask(event: FormEvent<HTMLFormElement>, taskId: string) {
    event.preventDefault()
    setAssignError(null)
    const assignee = (assignees[taskId] ?? '').trim()
    if (!assignee) {
      setAssignError('Enter an assignee before saving.')
      return
    }

    setAssigningTaskId(taskId)
    try {
      const updatedTask = await taskClient.assignTask(taskId, assignee)
      setTasks((current) => current.map((task) => task.id === taskId ? updatedTask : task))
      setConnectionStatus(useMockTaskClient ? 'Mock adapter' : 'MCP connected')
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : 'Could not assign task.')
      setConnectionStatus(useMockTaskClient ? 'Mock adapter' : 'MCP unavailable')
    } finally {
      setAssigningTaskId(null)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Commitment Radar home">
          <span className="brand-mark" aria-hidden="true">CR</span>
          <span>Commitment Radar</span>
        </a>
        <div className="connection-status" aria-live="polite">
          <span className={`status-dot${connectionStatus === 'MCP connected' ? ' status-dot--connected' : connectionStatus === 'MCP unavailable' ? ' status-dot--error' : ''}`} />
          {connectionStatus}
        </div>
      </header>

      <main className="dashboard">
        <div className="panel-grid">
          <section className="panel request-panel" aria-labelledby="request-title">
            <h1 id="request-title">Create a commitment</h1>
            <p>Save a task to the shared commitment list.</p>
            <form className="task-form" onSubmit={handleCreateTask} noValidate>
              <label htmlFor="task-title">Title <span aria-hidden="true">*</span></label>
              <input
                id="task-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                required
                disabled={isCreating}
                placeholder="What needs to get done?"
              />
              <label htmlFor="task-description">Description</label>
              <textarea
                id="task-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                disabled={isCreating}
                placeholder="Optional details"
              />
              <label htmlFor="task-assignee">Assignee</label>
              <input
                id="task-assignee"
                value={newAssignee}
                onChange={(event) => setNewAssignee(event.target.value)}
                disabled={isCreating}
                placeholder="Optional team member"
              />
              <label htmlFor="task-deadline">Deadline</label>
              <input
                id="task-deadline"
                type="datetime-local"
                value={deadline}
                onChange={(event) => setDeadline(event.target.value)}
                disabled={isCreating}
              />
              {createError && <p className="form-error" role="alert">{createError}</p>}
              <button className="primary-button" type="submit" disabled={isCreating}>
                {isCreating ? 'Saving…' : 'Create task'}
              </button>
            </form>
          </section>

          <section className="panel commitments-panel" aria-labelledby="commitments-title">
            <div className="panel-heading">
              <h2 id="commitments-title">Commitments</h2>
              <span>{tasks.length}</span>
            </div>
            <ul className="commitment-list" aria-live="polite">
              {isLoadingTasks && <li className="task-state">Loading commitments…</li>}
              {taskLoadError && <li className="task-state task-state--error" role="alert">{taskLoadError}</li>}
              {!isLoadingTasks && !taskLoadError && orderedTasks.length === 0 && (
                <li className="task-state">No commitments yet.</li>
              )}
              {!taskLoadError && orderedTasks.map((task) => (
                <li className="commitment" key={task.id}>
                  <div className="commitment__details">
                    <h3>{task.title}</h3>
                    {task.description && <p>{task.description}</p>}
                    <p>
                      {task.assignee ?? 'Unassigned'}
                      {task.deadline && (
                        <> <span aria-hidden="true">·</span> Due {formatDeadline(task.deadline)}</>
                      )}
                    </p>
                    <span className="task-status">{task.status}</span>
                    <form className="assignment-form" onSubmit={(event) => void handleAssignTask(event, task.id)}>
                      <label className="visually-hidden" htmlFor={`assignee-${task.id}`}>
                        Reassign {task.title}
                      </label>
                      <input
                        id={`assignee-${task.id}`}
                        value={assignees[task.id] ?? task.assignee ?? ''}
                        onChange={(event) => setAssignees((current) => ({
                          ...current,
                          [task.id]: event.target.value,
                        }))}
                        disabled={assigningTaskId === task.id}
                        required
                        placeholder="Assignee name"
                      />
                      <button type="submit" disabled={assigningTaskId === task.id}>
                        {assigningTaskId === task.id ? 'Saving…' : 'Reassign'}
                      </button>
                    </form>
                  </div>
                  {conflictingTaskIds.has(task.id) && (
                    <span className="conflict-badge" title="Same owner and deadline as another commitment">
                      Conflict
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {assignError && <p className="form-error" role="alert">{assignError}</p>}
          </section>

          <section className="panel mcp-panel" aria-labelledby="mcp-title">
            <div className="panel-heading">
              <h2 id="mcp-title">MCP activity</h2>
              <span className="mock-badge">{useMockTaskClient ? 'Mock adapter' : 'Live calls'}</span>
            </div>
            {useMockTaskClient ? (
              <p className="activity-empty">Mock adapter selected; no real MCP calls are being made.</p>
            ) : toolCalls.length === 0 ? (
              <p className="activity-empty">No MCP tool calls yet.</p>
            ) : (
              <ul className="tool-call-list" aria-live="polite">
                {toolCalls.map((toolCall) => (
                  <li className="tool-call" key={toolCall.id}>
                    <div className="tool-call__heading">
                      <h3>{toolCall.name}</h3>
                      <span className={toolCall.succeeded ? 'call-result' : 'call-result call-result--error'}>
                        {toolCall.succeeded ? 'Success' : 'Error'}
                      </span>
                    </div>
                    <dl>
                      <div>
                        <dt>Input</dt>
                        <dd><code>{JSON.stringify(toolCall.input, null, 2)}</code></dd>
                      </div>
                      <div>
                        <dt>Output</dt>
                        <dd><code>{toolCall.output}</code></dd>
                      </div>
                    </dl>
                    <time dateTime={toolCall.calledAt}>
                      {new Intl.DateTimeFormat(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      }).format(new Date(toolCall.calledAt))}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
