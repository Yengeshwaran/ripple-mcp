import { useEffect, useState } from 'react'
import './App.css'
import { MockTaskClient } from './services/mockTaskClient'
import type { Task, TaskClient } from './services/taskClient'

type ToolCall = {
  id: string
  name: string
  input: string
  output: string
}

// These mock traces illustrate the MCP workflow and are not live server calls.
const toolCalls: ToolCall[] = [
  {
    id: '1',
    name: 'save_commitment',
    input: '{ "title": "Prepare the Alexa+ demo recording", "owner": "Maya Chen" }',
    output: '{ "status": "example", "source": "mock data" }',
  },
  {
    id: '2',
    name: 'check_deadline_conflicts',
    input: '{ "owner": "Maya Chen", "deadline": "2026-10-23T12:00:00-07:00" }',
    output: '{ "conflict": "Same owner and deadline as another commitment" }',
  },
]

// This instance can be replaced when the team agrees on the backend transport.
const taskClient: TaskClient = new MockTaskClient()
const conflictingTaskIds = new Set(['task-1'])

function formatDueDate(deadline: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(deadline))
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null)

  // Load commitments through the TaskClient interface; the selected adapter is mock-only.
  useEffect(() => {
    let isCurrent = true

    taskClient.listTasks()
      .then((loadedTasks) => {
        if (isCurrent) {
          setTasks(loadedTasks)
          setIsLoadingTasks(false)
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setTaskLoadError(error instanceof Error ? error.message : 'Could not load tasks.')
          setIsLoadingTasks(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [])

  const orderedTasks = [...tasks].sort((first, second) =>
    (first.deadline ?? '').localeCompare(second.deadline ?? ''),
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Commitment Radar home">
          <span className="brand-mark" aria-hidden="true">CR</span>
          <span>Commitment Radar</span>
        </a>
        <span className="experience-label">Simulated Alexa+ experience</span>
      </header>

      <main className="dashboard">
        <div className="panel-grid">
          <section className="panel request-panel" aria-labelledby="request-title">
            <h1 id="request-title">Start with a meeting or a request</h1>
            <p>Capture what the team promised, who owns it, and when it is due.</p>
            <label className="request-label" htmlFor="request-input">
              Typed request
            </label>
            <textarea
              id="request-input"
              disabled
              placeholder="Example: Maya will prepare the demo by Thursday."
              rows={3}
            />
            <div className="request-actions">
              <button type="button" disabled>Choose meeting audio</button>
              <button type="button" className="primary-button" disabled>Send request</button>
            </div>
            <span className="mock-note">Input controls are a visual preview; no request is sent.</span>
          </section>

          <section className="panel commitments-panel" aria-labelledby="commitments-title">
            <div className="panel-heading">
              <h2 id="commitments-title">Commitments</h2>
              <span>{tasks.length}</span>
            </div>
            <ul className="commitment-list">
              {isLoadingTasks && <li className="task-state">Loading commitments…</li>}
              {taskLoadError && <li className="task-state task-state--error">{taskLoadError}</li>}
              {!isLoadingTasks && !taskLoadError && orderedTasks.length === 0 && (
                <li className="task-state">No commitments yet.</li>
              )}
              {!taskLoadError && orderedTasks.map((task) => (
                <li className="commitment" key={task.id}>
                  <div>
                    <h3>{task.title}</h3>
                    <p>
                      {task.assignee ?? 'Unassigned'}
                      {task.deadline && (
                        <> <span aria-hidden="true">·</span> Due {formatDueDate(task.deadline)}</>
                      )}
                    </p>
                  </div>
                  {conflictingTaskIds.has(task.id) && (
                    <span className="conflict-badge" title="Same owner and deadline as another commitment">
                      Conflict
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <span className="mock-note">Mock tasks from the TaskClient adapter</span>
          </section>

          <section className="panel mcp-panel" aria-labelledby="mcp-title">
            <div className="panel-heading">
              <h2 id="mcp-title">MCP activity</h2>
              <span className="mock-badge">Mock</span>
            </div>
            <ul className="tool-call-list">
              {toolCalls.map((toolCall) => (
                <li className="tool-call" key={toolCall.id}>
                  <h3>{toolCall.name}</h3>
                  <dl>
                    <div>
                      <dt>Input</dt>
                      <dd><code>{toolCall.input}</code></dd>
                    </div>
                    <div>
                      <dt>Output</dt>
                      <dd><code>{toolCall.output}</code></dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
