import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import './App.css'
import MeetingReviewPanel from './MeetingReviewPanel'
import { McpTaskClient } from './services/mcpTaskClient'
import { MockTaskClient } from './services/mockTaskClient'
import { demoCredentials, readLocalSession, signInLocal, signOutLocal, signUpLocal, type LocalUser } from './services/localDemoAuth'
import type { CreateTaskInput, Task, TaskClient, TaskStatus, TaskToolCall } from './services/taskClient'

const useMockTaskClient = import.meta.env.VITE_USE_MOCK_TASK_CLIENT === 'true'
type TaskFilter = 'all' | TaskStatus

function formatDeadline(deadline: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(deadline))
}

function formatActivityTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function findConflictingTaskIds(tasks: Task[]): Set<string> {
  const tasksByOwnerAndDeadline = new Map<string, string[]>()
  for (const task of tasks) {
    if (!task.assignee || !task.deadline) continue
    const key = `${task.assignee}\u0000${Date.parse(task.deadline)}`
    tasksByOwnerAndDeadline.set(key, [...(tasksByOwnerAndDeadline.get(key) ?? []), task.id])
  }
  return new Set(
    [...tasksByOwnerAndDeadline.values()].filter((taskIds) => taskIds.length > 1).flat(),
  )
}

function summarizeToolCall(toolCall: TaskToolCall): string {
  if (!toolCall.succeeded) return `Failed: ${toolCall.output.slice(0, 140)}`

  try {
    const result: unknown = JSON.parse(toolCall.output)
    if (toolCall.name === 'list_tasks' && Array.isArray(result)) {
      return `${result.length} commitment${result.length === 1 ? '' : 's'} returned`
    }
    if (typeof result === 'object' && result !== null) {
      const task = result as Record<string, unknown>
      if (toolCall.name === 'create_task' && typeof task.title === 'string') {
        return `Created “${task.title}”`
      }
      if (toolCall.name === 'assign_task' && typeof task.assignee === 'string') {
        return `Assigned to ${task.assignee}`
      }
    }
  } catch {
    return 'Completed successfully'
  }
  return 'Completed successfully'
}

type NavigationIconName = 'dashboard' | 'meeting' | 'commitments' | 'history' | 'team'
type AppPage = 'dashboard' | 'settings' | 'profile'
type WorkspacePreferences = {
  compactMode: boolean
  defaultFilter: TaskFilter
}

const preferenceStorageKey = 'commitment-radar-preferences'
const defaultWorkspacePreferences: WorkspacePreferences = {
  compactMode: false,
  defaultFilter: 'all',
}

function isTaskFilter(value: string): value is TaskFilter {
  return value === 'all' || value === 'open' || value === 'in_progress' || value === 'done'
}

function readWorkspacePreferences(): WorkspacePreferences {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(preferenceStorageKey) ?? 'null')
    if (typeof value !== 'object' || value === null) return defaultWorkspacePreferences
    const stored = value as Record<string, unknown>
    return {
      compactMode: stored.compactMode === true,
      defaultFilter: typeof stored.defaultFilter === 'string' && isTaskFilter(stored.defaultFilter)
        ? stored.defaultFilter
        : 'all',
    }
  } catch {
    return defaultWorkspacePreferences
  }
}

function SettingsIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z" /><path d="m19.4 13.5 1.1.9-1.3 2.3-1.4-.5a7.7 7.7 0 0 1-1.6.9l-.3 1.5h-2.7l-.3-1.5a7.7 7.7 0 0 1-1.6-.9l-1.4.5-1.3-2.3 1.1-.9a7 7 0 0 1 0-1.9l-1.1-.9 1.3-2.3 1.4.5a7.7 7.7 0 0 1 1.6-.9l.3-1.5h2.7l.3 1.5a7.7 7.7 0 0 1 1.6.9l1.4-.5 1.3 2.3-1.1.9a7 7 0 0 1 0 1.9Z" /></svg>
}

function SignOutIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M10 5H5.5A1.5 1.5 0 0 0 4 6.5v11A1.5 1.5 0 0 0 5.5 19H10M14 8l4 4-4 4M18 12H9" /></svg>
}

function NavigationIcon({ name }: { name: NavigationIconName }) {
  const sharedProps = {
    'aria-hidden': true as const,
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: 1.7,
    viewBox: '0 0 24 24',
  }

  switch (name) {
    case 'dashboard':
      return <svg {...sharedProps}><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></svg>
    case 'meeting':
      return <svg {...sharedProps}><path d="M12 5v14M5 12h14" /></svg>
    case 'commitments':
      return <svg {...sharedProps}><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r=".8" /><circle cx="4" cy="12" r=".8" /><circle cx="4" cy="18" r=".8" /></svg>
    case 'history':
      return <svg {...sharedProps}><path d="M3.5 11a8.5 8.5 0 1 1 2.3 5.8M3.5 5.5V11h5.5" /><path d="M12 7v5l3.2 2" /></svg>
    case 'team':
      return <svg {...sharedProps}><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20M16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8V20" /></svg>
  }
}

function AuthScreen({
  onAuthenticated,
  signOutNotice,
}: {
  onAuthenticated: (user: LocalUser) => void
  signOutNotice: string | null
}) {
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const user = mode === 'sign_in'
        ? await signInLocal(email, password)
        : await signUpLocal(name, email, password)
      onAuthenticated(user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete local sign-in.')
    } finally {
      setIsSubmitting(false)
    }
  }

  function fillDemoCredentials() {
    setMode('sign_in')
    setEmail(demoCredentials.email)
    setPassword(demoCredentials.password)
    setError(null)
  }

  function changeMode(nextMode: 'sign_in' | 'sign_up') {
    setMode(nextMode)
    setError(null)
  }

  return (
    <main className="auth-screen">
      <section className="auth-card" aria-labelledby="auth-title">
        <a className="auth-brand" href="/" aria-label="Commitment Radar home">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-copy"><strong>Commitment Radar</strong><small>Turn meetings into action</small></span>
        </a>
        <div className="auth-heading">
          <span className="eyebrow">LOCAL DEMO WORKSPACE</span>
          <h1 id="auth-title">{mode === 'sign_in' ? 'Welcome back' : 'Create your account'}</h1>
          <p>{mode === 'sign_in' ? 'Sign in to continue to your workspace.' : 'Create a local account for this browser.'}</p>
        </div>
        <div className="auth-mode-switch" role="tablist" aria-label="Authentication options">
          <button type="button" role="tab" aria-selected={mode === 'sign_in'} className={mode === 'sign_in' ? 'is-selected' : ''} onClick={() => changeMode('sign_in')}>Sign in</button>
          <button type="button" role="tab" aria-selected={mode === 'sign_up'} className={mode === 'sign_up' ? 'is-selected' : ''} onClick={() => changeMode('sign_up')}>Sign up</button>
        </div>
        <form className="auth-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
          {mode === 'sign_up' && (
            <>
              <label htmlFor="auth-name">Name</label>
              <input id="auth-name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={isSubmitting} placeholder="Your name" />
            </>
          )}
          <label htmlFor="auth-email">Email address</label>
          <input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={isSubmitting} placeholder="you@example.com" />
          <label htmlFor="auth-password">Password</label>
          <input id="auth-password" type="password" autoComplete={mode === 'sign_in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required disabled={isSubmitting} placeholder={mode === 'sign_in' ? 'Enter your password' : 'At least 8 characters'} />
          {error && <p className="form-error auth-error" role="alert">{error}</p>}
          {signOutNotice && mode === 'sign_in' && <p className="auth-signed-out" role="status">{signOutNotice}</p>}
          <button className="primary-button auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Please wait…' : mode === 'sign_in' ? 'Sign in' : 'Create local account'}
          </button>
        </form>
        <div className="demo-login">
          <div><strong>Try the demo account</strong><span>No account setup needed.</span></div>
          <button className="secondary-action" type="button" onClick={fillDemoCredentials} disabled={isSubmitting}>Use demo credentials</button>
          <dl><div><dt>Email</dt><dd>{demoCredentials.email}</dd></div><div><dt>Password</dt><dd>{demoCredentials.password}</dd></div></dl>
        </div>
        <p className="auth-disclaimer">
          Demo access only. Accounts are stored in this browser; authentication is not connected to or enforced by the MCP/API backend. Do not use real or sensitive credentials.
        </p>
      </section>
    </main>
  )
}

function SettingsPage({
  preferences,
  onPreferenceChange,
  notice,
  connectionStatus,
}: {
  preferences: WorkspacePreferences
  onPreferenceChange: (preferences: WorkspacePreferences) => void
  notice: string | null
  connectionStatus: string
}) {
  return (
    <section className="account-page" aria-labelledby="settings-title">
      <div className="page-heading account-page-heading">
        <div>
          <div className="breadcrumb">Workspace <span>/</span> Settings</div>
          <h1 id="settings-title">Settings</h1>
          <p>Adjust your workspace display and task board preferences.</p>
        </div>
      </div>
      {notice && <p className="preferences-notice" role="status">{notice}</p>}
      <div className="settings-layout">
        <section className="panel settings-panel" aria-labelledby="display-settings-title">
          <div className="settings-section-heading">
            <span className="settings-section-icon"><SettingsIcon /></span>
            <div><h2 id="display-settings-title">Display preferences</h2><p>Choose how information is presented in this workspace.</p></div>
          </div>
          <label className="preference-row" htmlFor="compact-mode">
            <span><strong>Compact layout</strong><small>Reduce spacing in commitment and activity lists.</small></span>
            <input
              id="compact-mode"
              type="checkbox"
              checked={preferences.compactMode}
              onChange={(event) => onPreferenceChange({ ...preferences, compactMode: event.target.checked })}
            />
          </label>
          <label className="preference-row preference-row--select" htmlFor="default-task-filter">
            <span><strong>Default commitment filter</strong><small>Use this filter when you return to the dashboard.</small></span>
            <select
              id="default-task-filter"
              value={preferences.defaultFilter}
              onChange={(event) => {
                const value = event.target.value
                if (isTaskFilter(value)) {
                  onPreferenceChange({ ...preferences, defaultFilter: value })
                }
              }}
            >
              <option value="all">All commitments</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="done">Completed</option>
            </select>
          </label>
        </section>

        <section className="panel settings-panel" aria-labelledby="workspace-settings-title">
          <div className="settings-section-heading">
            <span className="settings-section-icon settings-section-icon--connection"><span className="status-dot" /></span>
            <div><h2 id="workspace-settings-title">Workspace connection</h2><p>Current task service status and meeting upload limits.</p></div>
          </div>
          <dl className="settings-details">
            <div><dt>Task adapter</dt><dd>{useMockTaskClient ? 'Mock adapter' : 'MCP task tools'}</dd></div>
            <div><dt>Connection status</dt><dd><span className={`settings-connection${connectionStatus === 'Connected' ? ' is-connected' : connectionStatus === 'Unavailable' ? ' is-error' : ''}`}><span className="status-dot" />{useMockTaskClient ? 'Mock mode' : connectionStatus}</span></dd></div>
            <div><dt>Audio formats</dt><dd>WAV, MP3, M4A, WebM</dd></div>
            <div><dt>Recording limit</dt><dd>50 MB · 3 minutes</dd></div>
          </dl>
          <p className="settings-footnote">Connection settings are managed by the app environment and cannot be changed here.</p>
        </section>
      </div>
    </section>
  )
}

function ProfilePage({ user }: { user: LocalUser }) {
  return (
    <section className="account-page" aria-labelledby="profile-title">
      <div className="page-heading account-page-heading">
        <div>
          <div className="breadcrumb">Workspace <span>/</span> Profile</div>
          <h1 id="profile-title">Profile</h1>
          <p>Account and workspace access information.</p>
        </div>
      </div>
      <section className="panel profile-panel">
        <div className="profile-summary">
          <span className="profile-avatar profile-avatar--initial">{user.name.trim().charAt(0).toUpperCase()}</span>
          <div><h2>{user.name}</h2><p>{user.email}</p></div>
          <span className="profile-status"><span className="status-dot" />Workspace active</span>
        </div>
        <div className="profile-account-notice">
          <strong>Local demo account</strong>
          <p>This profile is stored in this browser only. It is not connected to server-side identity, team permissions, or an organization account.</p>
        </div>
        <dl className="settings-details profile-details">
          <div><dt>Workspace</dt><dd>Commitment Radar</dd></div>
          <div><dt>Access type</dt><dd>Browser-local account</dd></div>
          <div><dt>Authentication</dt><dd>Demo only · not server enforced</dd></div>
        </dl>
      </section>
    </section>
  )
}

function App() {
  const [session, setSession] = useState<LocalUser | null>(readLocalSession)
  const [toolCalls, setToolCalls] = useState<TaskToolCall[]>([])
  const [taskClient] = useState<TaskClient>(() =>
    useMockTaskClient
      ? new MockTaskClient()
      : new McpTaskClient((toolCall) => setToolCalls((current) => [toolCall, ...current].slice(0, 20))),
  )
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(true)
  const [taskLoadError, setTaskLoadError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState(
    useMockTaskClient ? 'Mock mode' : 'Connecting',
  )
  const [preferences, setPreferences] = useState<WorkspacePreferences>(readWorkspacePreferences)
  const [preferencesNotice, setPreferencesNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<TaskFilter>(() => readWorkspacePreferences().defaultFilter)
  const [activePage, setActivePage] = useState<AppPage>('dashboard')
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [deadline, setDeadline] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createNotice, setCreateNotice] = useState<string | null>(null)
  const [assignees, setAssignees] = useState<Record<string, string>>({})
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(
    () => window.matchMedia('(max-width: 820px)').matches,
  )
  const lastLoadedSession = useRef<string | null>(null)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 820px)')
    const updateViewport = (event: MediaQueryListEvent | MediaQueryList) => {
      setIsMobileViewport(event.matches)
      if (!event.matches) setMobileNavOpen(false)
    }
    updateViewport(mediaQuery)
    mediaQuery.addEventListener('change', updateViewport)
    return () => mediaQuery.removeEventListener('change', updateViewport)
  }, [])

  const loadTasks = useCallback(async (showLoading = false): Promise<string | null> => {
    if (showLoading) setIsLoadingTasks(true)
    setTaskLoadError(null)
    try {
      const loadedTasks = await taskClient.listTasks()
      setTasks(loadedTasks)
      setConnectionStatus(useMockTaskClient ? 'Mock mode' : 'Connected')
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load commitments.'
      setTaskLoadError(message)
      setConnectionStatus(useMockTaskClient ? 'Mock mode' : 'Unavailable')
      return message
    } finally {
      setIsLoadingTasks(false)
    }
  }, [taskClient])

  useEffect(() => {
    if (!session) {
      lastLoadedSession.current = null
      setIsLoadingTasks(false)
      return
    }
    if (lastLoadedSession.current === session.email) return
    lastLoadedSession.current = session.email
    void loadTasks(true)
  }, [loadTasks, session])

  useEffect(() => {
    if (!isCreateOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isCreating) setIsCreateOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCreateOpen, isCreating])

  const orderedTasks = [...tasks].sort((first, second) =>
    (first.deadline ?? '').localeCompare(second.deadline ?? ''),
  )
  const visibleTasks = orderedTasks.filter((task) => filter === 'all' || task.status === filter)
  const conflictingTaskIds = findConflictingTaskIds(orderedTasks)
  const teammates = [...new Set(tasks.map((task) => task.assignee).filter((assignee): assignee is string => Boolean(assignee)))]

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setCreateError(null)
    setCreateNotice(null)
    const normalizedTitle = title.trim()
    if (!normalizedTitle) {
      setCreateError('A commitment title is required.')
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
      setIsCreateOpen(false)
      const refreshError = await loadTasks()
      setCreateNotice(refreshError
        ? 'Commitment created, but the list could not be refreshed. Use Refresh to try again.'
        : 'Commitment created.')
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Could not create commitment.')
      setConnectionStatus(useMockTaskClient ? 'Mock mode' : 'Unavailable')
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
      setConnectionStatus(useMockTaskClient ? 'Mock mode' : 'Connected')
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : 'Could not assign task.')
      setConnectionStatus(useMockTaskClient ? 'Mock mode' : 'Unavailable')
    } finally {
      setAssigningTaskId(null)
    }
  }

  function navigateTo(id: string) {
    setMobileNavOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function toggleNavigation() {
    if (isMobileViewport) {
      setMobileNavOpen((open) => !open)
    } else {
      setSidebarCollapsed((collapsed) => !collapsed)
    }
  }

  function openPage(page: AppPage) {
    setActivePage(page)
    setMobileNavOpen(false)
    if (page === 'dashboard') setFilter(preferences.defaultFilter)
  }

  function updatePreferences(nextPreferences: WorkspacePreferences) {
    setPreferences(nextPreferences)
    setPreferencesNotice(null)
    setFilter(nextPreferences.defaultFilter)
    try {
      window.localStorage.setItem(preferenceStorageKey, JSON.stringify(nextPreferences))
      setPreferencesNotice('Preferences saved on this device.')
    } catch (error) {
      setPreferencesNotice(error instanceof Error
        ? `Preferences apply for this session but could not be saved: ${error.message}`
        : 'Preferences apply for this session but could not be saved in browser storage.')
    }
  }

  function handleSignOut() {
    signOutLocal()
    setSession(null)
    setTasks([])
    setToolCalls([])
    setActivePage('dashboard')
    setMobileNavOpen(false)
    setSignOutNotice('You have signed out of this browser session.')
  }

  const connectionClass = connectionStatus === 'Connected'
    ? 'is-connected'
    : connectionStatus === 'Unavailable'
      ? 'is-error'
      : ''

  if (!session) {
    return (
      <AuthScreen
        onAuthenticated={(user) => {
          setSession(user)
          setSignOutNotice(null)
          setActivePage('dashboard')
        }}
        signOutNotice={signOutNotice}
      />
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="mobile-menu-button"
          type="button"
          aria-label={isMobileViewport
            ? mobileNavOpen ? 'Close navigation' : 'Open navigation'
            : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-controls="main-sidebar"
          aria-expanded={isMobileViewport ? mobileNavOpen : !sidebarCollapsed}
          title={isMobileViewport
            ? mobileNavOpen ? 'Close navigation' : 'Open navigation'
            : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleNavigation}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <a className="brand" href="#dashboard" onClick={(event) => {
          event.preventDefault()
          navigateTo('dashboard')
        }} aria-label="Commitment Radar dashboard">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span className="brand-copy">
            <strong>Commitment Radar</strong>
            <small>Turn meetings into action</small>
          </span>
        </a>
        <div className="topbar-right">
          <div className={`connection-status ${connectionClass}`} aria-live="polite" title={connectionStatus}>
            <span className="status-dot" />
            {useMockTaskClient ? 'Mock mode' : connectionStatus === 'Connected' ? 'MCP connected' : connectionStatus === 'Unavailable' ? 'MCP unavailable' : 'Connecting to MCP'}
          </div>
          <span className="topbar-divider" />
          <span className="topbar-workspace">Team workspace</span>
          <span className="topbar-divider topbar-account-divider" />
          <button className={`topbar-icon-button${activePage === 'settings' ? ' is-current' : ''}`} type="button" aria-label="Settings" title="Settings" onClick={() => openPage('settings')}>
            <SettingsIcon />
          </button>
          <button className={`topbar-profile-button${activePage === 'profile' ? ' is-current' : ''}`} type="button" aria-label={`Profile: ${session.name}`} title={`Profile: ${session.name}`} onClick={() => openPage('profile')}>
            <span>{session.name.trim().charAt(0).toUpperCase()}</span>
          </button>
        </div>
      </header>

      <div className={`app-body${mobileNavOpen ? ' app-body--nav-open' : ''}${sidebarCollapsed && !isMobileViewport ? ' app-body--sidebar-collapsed' : ''}`}>
        {mobileNavOpen && (
          <button
            className="nav-backdrop"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
          />
        )}
        <aside className="sidebar" id="main-sidebar" aria-label="Main navigation">
          <span className="sidebar-label">WORKSPACE</span>
          <nav className="sidebar-nav">
            <button className={`nav-item${activePage === 'dashboard' ? ' is-active' : ''}`} type="button" aria-label="Dashboard" title={sidebarCollapsed && !isMobileViewport ? 'Dashboard' : undefined} onClick={() => openPage('dashboard')}>
              <span className="nav-icon"><NavigationIcon name="dashboard" /></span><span>Dashboard</span>
            </button>
            <button className="nav-item" type="button" aria-label="New meeting" title={sidebarCollapsed && !isMobileViewport ? 'New meeting' : undefined} onClick={() => navigateTo('meeting-workspace')}>
              <span className="nav-icon"><NavigationIcon name="meeting" /></span><span>New meeting</span>
            </button>
            <button className="nav-item" type="button" aria-label={`Commitments, ${tasks.length}`} title={sidebarCollapsed && !isMobileViewport ? `Commitments, ${tasks.length}` : undefined} onClick={() => navigateTo('commitments')}>
              <span className="nav-icon"><NavigationIcon name="commitments" /></span><span>Commitments</span>
              <span className="nav-count">{tasks.length}</span>
            </button>
            <button className="nav-item" type="button" aria-label="Meeting history, coming soon" disabled title="Meeting history is not available in this workspace yet.">
              <span className="nav-icon"><NavigationIcon name="history" /></span><span>Meeting history</span><span className="nav-soon">Soon</span>
            </button>
            <button className="nav-item" type="button" aria-label="Team" title={sidebarCollapsed && !isMobileViewport ? 'Team' : undefined} onClick={() => navigateTo('team-mapping')}>
              <span className="nav-icon"><NavigationIcon name="team" /></span><span>Team</span>
            </button>
          </nav>
          <div className="sidebar-bottom">
            <button className="sidebar-logout" type="button" aria-label="Sign out" title={sidebarCollapsed && !isMobileViewport ? 'Sign out' : undefined} onClick={handleSignOut}>
              <span className="nav-icon"><SignOutIcon /></span><span>Sign out</span>
            </button>
            <div className="sidebar-mode">
              <span className={`mode-indicator${useMockTaskClient ? ' mode-indicator--mock' : ''}`} />
              <div><strong>{useMockTaskClient ? 'Demo workspace' : 'Live workspace'}</strong><small>{useMockTaskClient ? 'Mock adapter active' : 'MCP task tools'}</small></div>
            </div>
          </div>
        </aside>

        <main className={`dashboard${preferences.compactMode ? ' dashboard--compact' : ''}`} id="dashboard">
          {activePage === 'settings' ? (
            <SettingsPage
              preferences={preferences}
              onPreferenceChange={updatePreferences}
              notice={preferencesNotice}
              connectionStatus={connectionStatus}
            />
          ) : activePage === 'profile' ? (
            <ProfilePage user={session} />
          ) : (
          <>
          <div className="page-heading">
            <div>
              <div className="breadcrumb">Workspace <span>/</span> Overview</div>
              <h1>Your workspace</h1>
              <p>Keep conversations moving and commitments on track.</p>
            </div>
            <button className="primary-button create-commitment-button" type="button" onClick={() => {
              setCreateError(null)
              setIsCreateOpen(true)
            }}>
              <span aria-hidden="true">＋</span> Create commitment
            </button>
          </div>

          {createNotice && <p className="create-notice" role="status">{createNotice}</p>}

          <MeetingReviewPanel
            taskClient={taskClient}
            teammates={teammates}
            onTasksSaved={async () => {
              const error = await loadTasks(true)
              if (error) throw new Error(error)
            }}
          />

          <div className="workspace-grid">
            <section className="panel commitments-panel" id="commitments" aria-labelledby="commitments-title">
              <div className="panel-heading commitments-heading">
                <div>
                  <span className="eyebrow">YOUR TASK BOARD</span>
                  <h2 id="commitments-title">Commitments <span className="heading-count">{tasks.length}</span></h2>
                  <p>Every action your team has agreed to.</p>
                </div>
                <div className="commitment-heading-actions">
                  <button className="icon-button refresh-button" type="button" onClick={() => void loadTasks(true)} disabled={isLoadingTasks} aria-label="Refresh commitments" title="Refresh commitments">
                    <span aria-hidden="true">↻</span>
                  </button>
                  <button className="secondary-action" type="button" onClick={() => {
                    setCreateError(null)
                    setIsCreateOpen(true)
                  }}>＋ Add commitment</button>
                </div>
              </div>
              <div className="task-filters" role="tablist" aria-label="Filter commitments">
                {([
                  ['all', 'All', tasks.length],
                  ['open', 'Open', tasks.filter((task) => task.status === 'open').length],
                  ['in_progress', 'In progress', tasks.filter((task) => task.status === 'in_progress').length],
                  ['done', 'Completed', tasks.filter((task) => task.status === 'done').length],
                ] as const).map(([value, label, count]) => (
                  <button
                    className={`filter-tab${filter === value ? ' is-selected' : ''}`}
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}<span>{count}</span>
                  </button>
                ))}
              </div>
              {assignError && <p className="form-error assignment-error" role="alert">{assignError}</p>}
              {isLoadingTasks ? (
                <div className="task-state loading-state"><span className="spinner" aria-hidden="true" /> Loading commitments…</div>
              ) : taskLoadError ? (
                <div className="list-error" role="alert">
                  <span>{taskLoadError}</span>
                  <button className="text-button" type="button" onClick={() => void loadTasks(true)}>Try again</button>
                </div>
              ) : visibleTasks.length === 0 ? (
                <div className="commitment-empty">
                  <span className="empty-icon" aria-hidden="true">☷</span>
                  <strong>{tasks.length === 0 ? 'No commitments yet' : `No ${filter === 'in_progress' ? 'in-progress' : filter} commitments`}</strong>
                  <p>{tasks.length === 0 ? 'Create a task or analyze a meeting to capture your team’s next steps.' : 'Try another filter to find a commitment.'}</p>
                  {tasks.length === 0 && <button className="secondary-action" type="button" onClick={() => setIsCreateOpen(true)}>＋ Create commitment</button>}
                </div>
              ) : (
                <ul className="commitment-list" aria-live="polite">
                  {visibleTasks.map((task) => (
                    <li className="commitment-row" key={task.id}>
                      <span className={`task-check task-check--${task.status}`} aria-hidden="true">{task.status === 'done' ? '✓' : task.status === 'in_progress' ? '◒' : ''}</span>
                      <div className="commitment__details">
                        <h3>{task.title}</h3>
                        {task.description && <p className="commitment-description">{task.description}</p>}
                        <div className="commitment-meta">
                          <span className="assignee-avatar" aria-hidden="true">{task.assignee?.trim().charAt(0).toUpperCase() ?? '—'}</span>
                          <span>{task.assignee ?? 'Unassigned'}</span>
                          {task.deadline && <><span className="meta-separator">·</span><span>Due {formatDeadline(task.deadline)}</span></>}
                        </div>
                        <span className={`task-status task-status--${task.status}`}>{task.status === 'open' ? 'Open' : task.status === 'in_progress' ? 'In progress' : 'Completed'}</span>
                        {conflictingTaskIds.has(task.id) && <span className="conflict-badge" title="Same owner and deadline as another commitment">Deadline conflict</span>}
                        <details className="assignment-details">
                          <summary>Reassign</summary>
                          <form className="assignment-form" onSubmit={(event) => void handleAssignTask(event, task.id)}>
                            <label className="visually-hidden" htmlFor={`assignee-${task.id}`}>Reassign {task.title}</label>
                            <input
                              id={`assignee-${task.id}`}
                              value={assignees[task.id] ?? task.assignee ?? ''}
                              onChange={(event) => setAssignees((current) => ({ ...current, [task.id]: event.target.value }))}
                              disabled={assigningTaskId === task.id}
                              required
                              placeholder="Teammate name"
                            />
                            <button type="submit" disabled={assigningTaskId === task.id}>{assigningTaskId === task.id ? 'Saving…' : 'Save'}</button>
                          </form>
                        </details>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel mcp-panel" aria-labelledby="mcp-title">
              <div className="panel-heading commitments-heading">
                <div>
                  <span className="eyebrow">INTEGRATION LOG</span>
                  <h2 id="mcp-title">MCP activity</h2>
                </div>
                <span className={`mode-pill${useMockTaskClient ? ' mode-pill--mock' : ''}`}>
                  <span className="status-dot" />{useMockTaskClient ? 'Mock mode' : connectionStatus === 'Connected' ? 'Live' : connectionStatus === 'Unavailable' ? 'Offline' : 'Connecting'}
                </span>
              </div>
              <p className="activity-description">
                {useMockTaskClient
                  ? 'Mock adapter is selected. These operations do not call an MCP server.'
                  : 'Recent calls and responses from your connected MCP task server.'}
              </p>
              {!useMockTaskClient && toolCalls.length === 0 ? (
                <div className="activity-empty"><span className="activity-empty-mark" aria-hidden="true">↗</span><span>No MCP operations recorded yet.</span></div>
              ) : !useMockTaskClient ? (
                <ul className="tool-call-list" aria-live="polite">
                  {toolCalls.map((toolCall) => (
                    <li className="activity-entry" key={toolCall.id}>
                      <div className="activity-entry__icon" aria-hidden="true">{toolCall.name === 'list_tasks' ? '☷' : toolCall.name === 'assign_task' ? '♧' : '＋'}</div>
                      <div className="activity-entry__main">
                        <div className="activity-entry__title">
                          <strong>{toolCall.name}</strong>
                          <span className={`call-result${toolCall.succeeded ? '' : ' call-result--error'}`}>{toolCall.succeeded ? 'Success' : 'Failed'}</span>
                        </div>
                        <span className="activity-entry__summary">{summarizeToolCall(toolCall)}</span>
                        <time dateTime={toolCall.calledAt}>{formatActivityTime(toolCall.calledAt)}</time>
                        <details className="activity-details">
                          <summary>View request and response</summary>
                          <dl>
                            <div><dt>Input</dt><dd><code>{JSON.stringify(toolCall.input, null, 2)}</code></dd></div>
                            <div><dt>Output</dt><dd><code>{toolCall.output}</code></dd></div>
                          </dl>
                        </details>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="activity-empty"><span className="activity-empty-mark" aria-hidden="true">◌</span><span>Mock mode does not generate live MCP activity records.</span></div>
              )}
            </section>
          </div>
          <footer className="dashboard-footer">
            <span>Commitment Radar</span><span>Meetings into action, one commitment at a time.</span>
          </footer>
          </>
          )}
        </main>
      </div>

      {isCreateOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isCreating) setIsCreateOpen(false)
        }}>
          <section className="create-modal" role="dialog" aria-modal="true" aria-labelledby="create-modal-title">
            <div className="modal-heading">
              <div><span className="eyebrow">TASK MANAGEMENT</span><h2 id="create-modal-title">Create commitment</h2><p>Add a clear next step for your team.</p></div>
              <button className="icon-button" type="button" aria-label="Close dialog" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>×</button>
            </div>
            <form className="task-form" onSubmit={(event) => void handleCreateTask(event)} noValidate>
              <label htmlFor="task-title">Title <span aria-hidden="true">*</span></label>
              <input id="task-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} required disabled={isCreating} placeholder="What needs to get done?" autoFocus />
              <label htmlFor="task-description">Description <span className="optional-label">Optional</span></label>
              <textarea id="task-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} disabled={isCreating} placeholder="Add context or details" />
              <label htmlFor="task-assignee">Assignee <span className="optional-label">Optional</span></label>
              <input id="task-assignee" value={newAssignee} onChange={(event) => setNewAssignee(event.target.value)} disabled={isCreating} placeholder="Assign to a teammate" />
              <label htmlFor="task-deadline">Deadline <span className="optional-label">Optional · your local time</span></label>
              <input id="task-deadline" type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} disabled={isCreating} />
              {createError && <p className="form-error" role="alert">{createError}</p>}
              <div className="modal-actions">
                <button className="secondary-action" type="button" onClick={() => setIsCreateOpen(false)} disabled={isCreating}>Cancel</button>
                <button className="primary-button" type="submit" disabled={isCreating}>{isCreating ? 'Creating…' : 'Create commitment'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}

export default App
