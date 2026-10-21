import { useMemo, useState, type ChangeEvent, type DragEvent } from 'react'
import { analyzeMeeting, type CandidateTask, type MeetingAnalysis } from './services/voiceAnalysis'
import { sampleMeetingAnalysis } from './services/voiceAnalysisFixture'
import type { TaskClient } from './services/taskClient'

const maxAudioBytes = 25 * 1024 * 1024
const maxAudioDurationSeconds = 3 * 60
const audioDurationRoundingToleranceSeconds = 1
const supportedExtensions = new Set(['wav', 'mp3', 'm4a', 'webm'])

type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'saved'
type ReviewCandidate = CandidateTask & {
  reviewStatus: ReviewStatus
  deadlineLocal: string
  saveError?: string
}

type MeetingReviewPanelProps = {
  taskClient: TaskClient
  teammates: string[]
  onTasksSaved: () => Promise<void>
}

function createReviewCandidates(analysis: MeetingAnalysis): ReviewCandidate[] {
  return analysis.candidate_tasks.map((candidate) => ({
    ...candidate,
    reviewStatus: 'pending',
    deadlineLocal: candidate.deadline_iso ? toLocalDateTime(candidate.deadline_iso) : '',
  }))
}

function toLocalDateTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function formatTimestamp(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function extensionOf(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() ?? ''
}

async function inspectAudioDuration(file: File): Promise<number | undefined> {
  const objectUrl = URL.createObjectURL(file)
  try {
    return await new Promise<number | undefined>((resolve) => {
      const audio = new Audio()
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => resolve(Number.isFinite(audio.duration) ? audio.duration : undefined)
      audio.onerror = () => resolve(undefined)
      audio.src = objectUrl
    })
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function formatFileSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MB`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

function MeetingReviewPanel({ taskClient, teammates, onTasksSaved }: MeetingReviewPanelProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [selectedDuration, setSelectedDuration] = useState<number | undefined>()
  const [meetingDate, setMeetingDate] = useState('')
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileWarning, setFileWarning] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [isInspectingFile, setIsInspectingFile] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<MeetingAnalysis | null>(null)
  const [isSamplePreview, setIsSamplePreview] = useState(false)
  const [speakerMappings, setSpeakerMappings] = useState<Record<string, string>>({})
  const [customSpeakerMappings, setCustomSpeakerMappings] = useState<Record<string, string>>({})
  const [candidates, setCandidates] = useState<ReviewCandidate[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [saveSummary, setSaveSummary] = useState<string | null>(null)
  const [transcriptSearch, setTranscriptSearch] = useState('')
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null)
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(new Set())

  const resetReview = () => {
    setAnalysis(null)
    setCandidates([])
    setSpeakerMappings({})
    setCustomSpeakerMappings({})
    setSaveSummary(null)
    setAnalysisError(null)
    setIsSamplePreview(false)
    setTranscriptSearch('')
    setSelectedSegmentId(null)
    setSelectedCandidateIds(new Set())
  }

  const inspectSelectedFile = async (file: File | null) => {
    setSelectedFile(file)
    setSelectedDuration(undefined)
    setFileError(null)
    setFileWarning(null)
    resetReview()
    if (!file) return

    if (!supportedExtensions.has(extensionOf(file.name))) {
      setFileError('Choose a WAV, MP3, M4A, or WebM audio file.')
      return
    }
    if (file.size === 0) {
      setFileError('This file is empty. Choose a recording with audio.')
      return
    }
    if (file.size > maxAudioBytes) {
      setFileError(`This file exceeds the 25 MB upload limit (${formatFileSize(file.size)}).`)
      return
    }
    if (file.type && !file.type.startsWith('audio/') && file.type !== 'application/octet-stream') {
      setFileError('The selected file does not appear to be an audio recording.')
      return
    }

    setIsInspectingFile(true)
    try {
      const duration = await inspectAudioDuration(file)
      setSelectedDuration(duration)
      if (duration !== undefined && duration > maxAudioDurationSeconds + audioDurationRoundingToleranceSeconds) {
        setFileError('Choose a recording that is 3 minutes or shorter.')
      } else if (duration === undefined) {
        setFileWarning('Duration could not be checked in this browser. The server will enforce the 3-minute limit.')
      }
    } catch {
      setFileWarning('Duration could not be checked in this browser. The server will enforce the 3-minute limit.')
    } finally {
      setIsInspectingFile(false)
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    event.currentTarget.value = ''
    void inspectSelectedFile(file)
  }

  const handleFileDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsDraggingFile(false)
    if (isInspectingFile || isAnalyzing || isSaving) return
    const file = event.dataTransfer.files[0] ?? null
    if (file) void inspectSelectedFile(file)
  }

  const handleAnalyze = async () => {
    if (!selectedFile || fileError || isInspectingFile) return
    setIsAnalyzing(true)
    setAnalysisError(null)
    setFileWarning(null)
    resetReview()
    try {
      const result = await analyzeMeeting(selectedFile, {
        meetingDate: meetingDate || undefined,
        timezone: timezone.trim() || undefined,
      })
      setAnalysis(result)
      setCandidates(createReviewCandidates(result))
    } catch (error) {
      setAnalysisError(errorMessage(error, 'Meeting analysis failed. Please try again.'))
    } finally {
      setIsAnalyzing(false)
    }
  }

  const loadSamplePreview = () => {
    setSelectedFile(null)
    setFileError(null)
    setFileWarning(null)
    setAnalysisError(null)
    setAnalysis(sampleMeetingAnalysis)
    setCandidates(createReviewCandidates(sampleMeetingAnalysis))
    setSpeakerMappings({})
    setCustomSpeakerMappings({})
    setSaveSummary(null)
    setIsSamplePreview(true)
    setSelectedCandidateIds(new Set())
  }

  const setCandidateField = (candidateId: string, field: 'title' | 'description' | 'deadlineLocal', value: string) => {
    if (isSamplePreview) return
    setCandidates((current) => current.map((candidate) =>
      candidate.id === candidateId ? { ...candidate, [field]: value, saveError: undefined } : candidate,
    ))
  }

  const setCandidateStatus = (candidateId: string, reviewStatus: ReviewStatus) => {
    if (isSamplePreview) return
    setCandidates((current) => current.map((candidate) =>
      candidate.id === candidateId ? { ...candidate, reviewStatus, saveError: undefined } : candidate,
    ))
    setSaveSummary(null)
  }

  const resolvedSpeakerMapping = (speakerId: string | null): string | undefined => {
    if (!speakerId) return undefined
    const value = speakerMappings[speakerId]
    if (value === '__custom__') return customSpeakerMappings[speakerId]?.trim() || undefined
    return value?.trim() || undefined
  }

  const handleSaveApproved = async () => {
    if (isSamplePreview) return
    const approved = candidates.filter((candidate) => candidate.reviewStatus === 'approved')
    if (approved.length === 0) return

    setIsSaving(true)
    setSaveSummary(null)
    let savedCount = 0
    const failedTitles: string[] = []
    let refreshError: string | null = null
    for (const candidate of approved) {
      const title = candidate.title.trim()
      if (!title) {
        failedTitles.push(candidate.title || 'Untitled task')
        setCandidates((current) => current.map((item) =>
          item.id === candidate.id ? { ...item, saveError: 'A task title is required.' } : item,
        ))
        continue
      }

      try {
        const deadline = candidate.deadlineLocal
          ? new Date(candidate.deadlineLocal).toISOString()
          : undefined
        await taskClient.createTask({
          title,
          ...(candidate.description.trim() && { description: candidate.description.trim() }),
          ...(resolvedSpeakerMapping(candidate.owner_speaker_id) && {
            assignee: resolvedSpeakerMapping(candidate.owner_speaker_id),
          }),
          ...(deadline && { deadline }),
        })
        savedCount += 1
        setCandidateStatus(candidate.id, 'saved')
      } catch (error) {
        const message = errorMessage(error, 'Could not save this task.')
        failedTitles.push(title)
        setCandidates((current) => current.map((item) =>
          item.id === candidate.id ? { ...item, saveError: message } : item,
        ))
      }
    }

    if (savedCount > 0) {
      try {
        await onTasksSaved()
      } catch (error) {
        refreshError = errorMessage(error, 'Refresh failed.')
      }
    }
    const resultMessages: string[] = []
    if (savedCount > 0) {
      resultMessages.push(`${savedCount} task${savedCount === 1 ? '' : 's'} saved.`)
    }
    if (failedTitles.length > 0) {
      resultMessages.push(`Could not save: ${failedTitles.join(', ')}.`)
    }
    if (refreshError) resultMessages.push(`Task list refresh failed: ${refreshError}`)
    setSaveSummary(resultMessages.join(' '))
    setIsSaving(false)
  }

  const approvedCount = candidates.filter((candidate) => candidate.reviewStatus === 'approved').length
  const segmentById = new Map((analysis?.segments ?? []).map((segment) => [segment.id, segment]))
  const visibleTranscriptSegments = useMemo(
    () => (analysis?.segments ?? []).filter((segment) =>
      !transcriptSearch.trim() || segment.text.toLocaleLowerCase().includes(transcriptSearch.trim().toLocaleLowerCase()) ||
      (segment.speaker_id ?? '').toLocaleLowerCase().includes(transcriptSearch.trim().toLocaleLowerCase()) ||
      (resolvedSpeakerMapping(segment.speaker_id) ?? '').toLocaleLowerCase().includes(transcriptSearch.trim().toLocaleLowerCase()),
    ),
    [analysis, transcriptSearch, speakerMappings, customSpeakerMappings],
  )
  const eligibleCandidates = candidates.filter((candidate) =>
    candidate.reviewStatus === 'pending' || candidate.reviewStatus === 'approved',
  )
  const allEligibleSelected = eligibleCandidates.length > 0 &&
    eligibleCandidates.every((candidate) => selectedCandidateIds.has(candidate.id))

  const toggleCandidateSelection = (candidateId: string) => {
    if (isSamplePreview) return
    setSelectedCandidateIds((current) => {
      const next = new Set(current)
      if (next.has(candidateId)) next.delete(candidateId)
      else next.add(candidateId)
      return next
    })
  }

  const approveSelectedCandidates = () => {
    if (isSamplePreview) return
    setCandidates((current) => current.map((candidate) =>
      selectedCandidateIds.has(candidate.id) && candidate.reviewStatus === 'pending'
        ? { ...candidate, reviewStatus: 'approved' }
        : candidate,
    ))
    setSelectedCandidateIds(new Set())
    setSaveSummary(null)
  }

  return (
    <section className="meeting-workspace panel" id="meeting-workspace" aria-labelledby="meeting-title">
      <div className="meeting-intro">
        <div>
          <span className="eyebrow">MEETING WORKFLOW</span>
          <h1 id="meeting-title">Turn a conversation into clear commitments</h1>
          <p>Upload a short recording, review the transcript and suggestions, then choose exactly what to save.</p>
        </div>
        <span className="consent-note"><span aria-hidden="true">●</span> Upload consented recordings only</span>
      </div>

      <ol className="workflow-steps" aria-label="Meeting review steps">
        {([
          { label: 'Upload', complete: Boolean(selectedFile && !fileError), active: !analysis && !isAnalyzing },
          { label: 'Process', complete: Boolean(analysis), active: isAnalyzing },
          { label: 'Review', complete: Boolean(analysis && candidates.length > 0 && candidates.every((candidate) => candidate.reviewStatus !== 'pending')), active: Boolean(analysis && (candidates.length === 0 || candidates.some((candidate) => candidate.reviewStatus === 'pending'))) },
          { label: 'Save', complete: candidates.some((candidate) => candidate.reviewStatus === 'saved'), active: approvedCount > 0 },
        ]).map((step, index) => (
          <li className={`workflow-step${step.complete ? ' workflow-step--complete' : ''}${step.active ? ' workflow-step--active' : ''}`} key={step.label}>
            <span>{step.complete ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>{step.label}</strong>
          </li>
        ))}
      </ol>

      <div className="upload-layout">
        <div className="upload-card">
          <div className="upload-card__heading">
            <span className="step-icon" aria-hidden="true">↑</span>
            <div>
              <h2>Upload meeting audio</h2>
              <p>WAV, MP3, M4A, or WebM · up to 25 MB · 3 minutes.</p>
            </div>
          </div>
          <div className="meeting-context-grid">
            <label className="meeting-context-field" htmlFor="meeting-date">
              <span>Meeting date <small>Optional</small></span>
              <input
                id="meeting-date"
                type="date"
                value={meetingDate}
                onChange={(event) => setMeetingDate(event.target.value)}
                disabled={isInspectingFile || isAnalyzing || isSaving}
              />
            </label>
            <label className="meeting-context-field" htmlFor="meeting-timezone">
              <span>Timezone <small>IANA name</small></span>
              <input
                id="meeting-timezone"
                type="text"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
                placeholder="e.g. America/Chicago"
                autoComplete="off"
                disabled={isInspectingFile || isAnalyzing || isSaving}
              />
            </label>
            <p className="meeting-context-help">Provide the date and timezone to help resolve clearly spoken deadlines.</p>
          </div>
          <label
            className={`dropzone${selectedFile ? ' dropzone--selected' : ''}${isDraggingFile ? ' dropzone--dragging' : ''}`}
            htmlFor="meeting-audio"
            onDragEnter={(event) => { event.preventDefault(); setIsDraggingFile(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDraggingFile(false)
            }}
            onDrop={handleFileDrop}
          >
            <span className="dropzone__icon" aria-hidden="true">♫</span>
            <span className="dropzone__title">{selectedFile ? selectedFile.name : 'Drop your recording here'}</span>
            <span className="dropzone__meta">
              {selectedFile
                ? `${formatFileSize(selectedFile.size)}${selectedDuration !== undefined ? ` · ${Math.floor(selectedDuration / 60)}:${String(Math.floor(selectedDuration % 60)).padStart(2, '0')}` : ''}`
                : 'or browse files from your device'}
            </span>
            <input
              id="meeting-audio"
              type="file"
              accept=".wav,.mp3,.m4a,.webm,audio/wav,audio/mpeg,audio/mp4,audio/webm"
              onChange={(event) => void handleFileChange(event)}
              disabled={isInspectingFile || isAnalyzing || isSaving}
            />
            <span className="secondary-button" aria-hidden="true">Browse files</span>
          </label>
          {selectedFile && (
            <button className="remove-file-button" type="button" disabled={isAnalyzing || isInspectingFile || isSaving} onClick={() => void inspectSelectedFile(null)}>
              Remove recording
            </button>
          )}
          {fileError && <p className="inline-alert" role="alert">{fileError}</p>}
          {fileWarning && <p className="inline-warning" role="status">{fileWarning}</p>}
          {analysisError && <p className="inline-alert" role="alert">{analysisError}</p>}
          <div className="upload-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={!selectedFile || Boolean(fileError) || isInspectingFile || isAnalyzing || isSaving}
            >
              {isInspectingFile ? 'Checking recording…' : isAnalyzing ? 'Analyzing recording…' : 'Analyze meeting'}
            </button>
            <button className="text-button" type="button" onClick={loadSamplePreview} disabled={isInspectingFile || isAnalyzing || isSaving}>
              Preview with sample
            </button>
          </div>
          {isAnalyzing && (
            <div className="processing-state" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>Transcribing audio and preparing suggestions. This may take a moment.</span>
            </div>
          )}
          <p className="privacy-note">Audio is sent to the configured voice service for analysis. It is not stored in browser storage.</p>
        </div>

        <aside className="workflow-note">
          <span className="eyebrow">HUMAN REVIEW</span>
          <h3>Suggestions are not saved automatically</h3>
          <p>Speaker labels are anonymous. Map them to teammates yourself, review each task and save only the ones you approve.</p>
          <div className="workflow-note__footer">
            <span className="workflow-note__dot" />
            <span>Tasks are saved through the MCP task tools</span>
          </div>
        </aside>
      </div>

      {analysis && (
        <div className="analysis-results">
          <div className="results-heading">
            <div>
              <span className="eyebrow">{isSamplePreview ? 'SAMPLE PREVIEW' : 'ANALYSIS COMPLETE'}</span>
              <h2>Review your meeting</h2>
              <p>Meeting ID <code>{analysis.meeting_id}</code> <span aria-hidden="true">·</span> {analysis.segments.length} transcript segments</p>
            </div>
            <span className={isSamplePreview ? 'analysis-badge analysis-badge--sample' : 'analysis-badge'}>
              {isSamplePreview ? 'Synthetic sample' : 'Ready for review'}
            </span>
          </div>
          {isSamplePreview && (
            <p className="sample-banner" role="status">
              This is synthetic preview content for checking the workflow. No recording was uploaded or analyzed.
            </p>
          )}

          <div className="review-grid">
            <section className="review-section transcript-section" aria-labelledby="transcript-title">
              <div className="section-title-row" id="team-mapping">
                <div>
                  <span className="eyebrow">STEP 01</span>
                  <h3 id="transcript-title">Transcript</h3>
                </div>
                <span className="section-count">{analysis.segments.length} lines</span>
              </div>
              <label className="transcript-search">
                <span className="visually-hidden">Search transcript</span>
                <span aria-hidden="true">⌕</span>
                <input value={transcriptSearch} onChange={(event) => setTranscriptSearch(event.target.value)} placeholder="Search transcript or speakers" />
              </label>
              <div className="speaker-map-list">
                {analysis.speakers.map((speaker, index) => {
                  const value = speakerMappings[speaker.speaker_id] ?? ''
                  return (
                    <div className="speaker-map-row" key={speaker.speaker_id}>
                      <span className={`speaker-avatar speaker-avatar--${index % 4}`} aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="speaker-map-row__identity">
                        <strong>{speaker.speaker_id}</strong>
                        <span>
                          {speaker.first_seen_ms === null
                            ? 'First heard time unavailable'
                            : `First heard at ${formatTimestamp(speaker.first_seen_ms)}`}
                        </span>
                      </div>
                      <select
                        aria-label={`Map ${speaker.speaker_id} to a teammate`}
                        value={value && !teammates.includes(value) ? '__custom__' : value}
                        disabled={isSamplePreview}
                        onChange={(event) => setSpeakerMappings((current) => ({
                          ...current,
                          [speaker.speaker_id]: event.target.value,
                        }))}
                      >
                        <option value="">Unmapped</option>
                        {teammates.map((teammate) => <option value={teammate} key={teammate}>{teammate}</option>)}
                        <option value="__custom__">Enter teammate name…</option>
                      </select>
                      {(value === '__custom__' || (value && !teammates.includes(value))) && (
                        <input
                          className="custom-speaker-input"
                          aria-label={`Teammate name for ${speaker.speaker_id}`}
                          placeholder="Teammate name"
                          value={customSpeakerMappings[speaker.speaker_id] ?? (value === '__custom__' ? '' : value)}
                          disabled={isSamplePreview}
                          onChange={(event) => setCustomSpeakerMappings((current) => ({
                            ...current,
                            [speaker.speaker_id]: event.target.value,
                          }))}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
              <ol className="transcript-list">
                {visibleTranscriptSegments.map((segment) => {
                  const mappedName = resolvedSpeakerMapping(segment.speaker_id)
                  return (
                    <li className={`transcript-line${selectedSegmentId === segment.id ? ' transcript-line--selected' : ''}`} key={segment.id}>
                      <button className="transcript-time" type="button" onClick={() => setSelectedSegmentId(segment.id)} aria-label={`Select transcript segment starting at ${formatTimestamp(segment.start_ms)}`}>
                        {formatTimestamp(segment.start_ms)}–{formatTimestamp(segment.end_ms)}
                      </button>
                      <div>
                        <span className="transcript-speaker">
                          {mappedName || segment.speaker_id || 'Unidentified speaker'}
                          {mappedName && <small>{segment.speaker_id}</small>}
                        </span>
                        <p>{segment.text}</p>
                      </div>
                    </li>
                  )
                })}
                {visibleTranscriptSegments.length === 0 && <li className="transcript-no-results">No transcript lines match your search.</li>}
              </ol>
            </section>

            <section className="review-section candidates-section" aria-labelledby="candidates-title">
              <div className="section-title-row">
                <div>
                  <span className="eyebrow">STEP 02</span>
                  <h3 id="candidates-title">Suggested commitments</h3>
                </div>
                <span className="section-count">{candidates.length} suggestions</span>
              </div>
              <p className="review-helper">Edit each suggestion, then approve or reject it. Nothing is saved until you choose “Save approved”.</p>
              {eligibleCandidates.length > 0 && (
                <div className="candidate-bulk-actions">
                  <label>
                    <input
                      type="checkbox"
                      checked={allEligibleSelected}
                      disabled={isSamplePreview}
                      onChange={() => setSelectedCandidateIds(allEligibleSelected
                        ? new Set()
                        : new Set(eligibleCandidates.map((candidate) => candidate.id)))}
                      aria-label="Select all eligible candidates"
                    />
                    Select all eligible
                  </label>
                  {selectedCandidateIds.size > 0 && (
                    <button className="text-button" type="button" onClick={approveSelectedCandidates}>
                      Approve selected ({selectedCandidateIds.size})
                    </button>
                  )}
                </div>
              )}
              {candidates.length === 0 ? (
                <div className="empty-review">No task suggestions were returned for this meeting.</div>
              ) : (
                <div className="candidate-list">
                  {candidates.map((candidate, index) => {
                    const proposedSpeaker = candidate.owner_speaker_id
                    const mappedOwner = resolvedSpeakerMapping(proposedSpeaker)
                    const ownerWasUnmapped = Boolean(proposedSpeaker && !mappedOwner)
                    const evidence = candidate.evidence_segment_ids
                      .map((id) => segmentById.get(id))
                      .filter((segment) => segment !== undefined)
                    return (
                      <article
                        className={`candidate-card candidate-card--${candidate.reviewStatus}${selectedCandidateIds.has(candidate.id) ? ' candidate-card--selected' : ''}`}
                        key={candidate.id}
                      >
                        <div className="candidate-card__top">
                          <div className="candidate-label">
                            {candidate.reviewStatus !== 'saved' && candidate.reviewStatus !== 'rejected' && (
                              <input
                                type="checkbox"
                                checked={selectedCandidateIds.has(candidate.id)}
                                disabled={isSamplePreview}
                                onChange={() => toggleCandidateSelection(candidate.id)}
                                aria-label={`Select ${candidate.title}`}
                              />
                            )}
                            <span className="candidate-number">SUGGESTION {String(index + 1).padStart(2, '0')}</span>
                          </div>
                          <span className={`candidate-status candidate-status--${candidate.reviewStatus}`}>
                            {candidate.reviewStatus === 'pending' ? 'Needs review' : candidate.reviewStatus}
                          </span>
                        </div>
                        <label className="field-label" htmlFor={`candidate-title-${candidate.id}`}>Task title</label>
                        <input
                          id={`candidate-title-${candidate.id}`}
                          className="candidate-title-input"
                          value={candidate.title}
                          onChange={(event) => setCandidateField(candidate.id, 'title', event.target.value)}
                          disabled={isSamplePreview || candidate.reviewStatus === 'saved' || isSaving}
                        />
                        <label className="field-label" htmlFor={`candidate-description-${candidate.id}`}>Description</label>
                        <textarea
                          id={`candidate-description-${candidate.id}`}
                          value={candidate.description}
                          rows={2}
                          onChange={(event) => setCandidateField(candidate.id, 'description', event.target.value)}
                          disabled={isSamplePreview || candidate.reviewStatus === 'saved' || isSaving}
                        />
                        <div className="candidate-meta-grid">
                          <div>
                            <span className="field-label">Proposed owner</span>
                            <div className={ownerWasUnmapped ? 'uncertainty-chip' : 'candidate-value'}>
                              {mappedOwner
                                ? <>{mappedOwner} <span>from {proposedSpeaker}</span></>
                                : proposedSpeaker
                                  ? <>{proposedSpeaker} <span>map this speaker above</span></>
                                  : <span>Owner unclear · will remain unassigned</span>}
                            </div>
                          </div>
                          <div>
                            <label className="field-label" htmlFor={`candidate-deadline-${candidate.id}`}>Confirmed deadline · local time</label>
                            <input
                              id={`candidate-deadline-${candidate.id}`}
                              type="datetime-local"
                              value={candidate.deadlineLocal}
                              onChange={(event) => setCandidateField(candidate.id, 'deadlineLocal', event.target.value)}
                              disabled={isSamplePreview || candidate.reviewStatus === 'saved' || isSaving}
                            />
                            <span className="deadline-source">
                              {candidate.deadline_text
                                ? `Heard: “${candidate.deadline_text}”`
                                : 'No clear deadline in the transcript'}
                            </span>
                          </div>
                        </div>
                        <div className="evidence-block">
                          <span className="field-label">Transcript evidence</span>
                          {evidence.length > 0 ? evidence.map((segment) => (
                            <blockquote key={segment.id}>
                              <span>{formatTimestamp(segment.start_ms)} · {segment.speaker_id || 'Unknown speaker'}</span>
                              {segment.text}
                            </blockquote>
                          )) : <p className="evidence-missing">No matching transcript evidence was returned.</p>}
                        </div>
                        <div className="candidate-footer">
                          <span
                            className="confidence-note"
                            title="Model-provided scores are not calibrated probabilities; use the transcript evidence and your judgment."
                          >
                            {candidate.confidence !== undefined
                              ? `Model score ${Math.round(candidate.confidence * 100)}% · not calibrated`
                              : 'Review recommended'}
                            {candidate.needs_review && <span> · Verify details</span>}
                          </span>
                          {candidate.reviewStatus !== 'saved' && (
                            <div className="candidate-actions">
                              <button
                                className="reject-button"
                                type="button"
                                onClick={() => setCandidateStatus(candidate.id, 'rejected')}
                                disabled={isSamplePreview || isSaving}
                              >
                                Reject
                              </button>
                              <button
                                className="approve-button"
                                type="button"
                                onClick={() => setCandidateStatus(
                                  candidate.id,
                                  candidate.reviewStatus === 'approved' || candidate.reviewStatus === 'rejected'
                                    ? 'pending'
                                    : 'approved',
                                )}
                                disabled={isSamplePreview || isSaving}
                              >
                                {candidate.reviewStatus === 'approved'
                                  ? 'Approved'
                                  : candidate.reviewStatus === 'rejected'
                                    ? 'Restore to pending'
                                    : 'Approve'}
                              </button>
                            </div>
                          )}
                        </div>
                        {candidate.saveError && <p className="inline-alert" role="alert">{candidate.saveError}</p>}
                      </article>
                    )
                  })}
                </div>
              )}
              <div className="save-approved-bar">
                <div>
                  <strong>{approvedCount} approved</strong>
                  <span>Only approved suggestions will be sent to the task list.</span>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void handleSaveApproved()}
                  disabled={approvedCount === 0 || isSaving || isSamplePreview}
                >
                  {isSaving ? 'Saving approved tasks…' : `Save ${approvedCount ? `${approvedCount} approved` : 'approved'} task${approvedCount === 1 ? '' : 's'}`}
                </button>
              </div>
              {isSamplePreview && (
                <p className="inline-warning sample-save-note">Sample preview is read-only. Analyze a real recording to save tasks.</p>
              )}
              {saveSummary && <p className="save-summary" role="status">{saveSummary}</p>}
            </section>
          </div>
        </div>
      )}
    </section>
  )
}

export default MeetingReviewPanel
