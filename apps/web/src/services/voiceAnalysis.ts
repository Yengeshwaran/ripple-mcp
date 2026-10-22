export type MeetingSpeaker = {
  speaker_id: string
  first_seen_ms: number | null
}

export type TranscriptSegment = {
  id: string
  start_ms: number
  end_ms: number
  speaker_id: string | null
  text: string
}

export type CandidateTask = {
  id: string
  title: string
  description: string
  owner_speaker_id: string | null
  deadline_text: string | null
  deadline_iso: string | null
  evidence_segment_ids: string[]
  confidence?: number
  needs_review: boolean
}

export type MeetingAnalysis = {
  meeting_id: string
  speakers: MeetingSpeaker[]
  segments: TranscriptSegment[]
  candidate_tasks: CandidateTask[]
}

export type MeetingContext = {
  meetingDate?: string
  timezone?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Voice analysis response has an invalid "${key}" field.`)
  }
  return value
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error(`Voice analysis response has an invalid "${key}" field.`)
  }
  return value
}

function timestamp(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Voice analysis response has an invalid "${field}" timestamp.`)
  }
  return value
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
}

function parseMeetingAnalysis(value: unknown): MeetingAnalysis {
  if (!isRecord(value)) {
    throw new Error('Voice analysis response must be a JSON object.')
  }
  if (!Array.isArray(value.speakers) || !Array.isArray(value.segments) || !Array.isArray(value.candidate_tasks)) {
    throw new Error('Voice analysis response is missing speakers, segments, or candidate_tasks.')
  }

  const speakers = value.speakers.map((entry): MeetingSpeaker => {
    if (!isRecord(entry)) throw new Error('Voice analysis response contains an invalid speaker.')
    return {
      speaker_id: requiredString(entry, 'speaker_id'),
      first_seen_ms: entry.first_seen_ms === null || entry.first_seen_ms === undefined
        ? null
        : timestamp(entry.first_seen_ms, 'first_seen_ms'),
    }
  })
  const speakerIds = new Set(speakers.map((speaker) => speaker.speaker_id))
  if (speakerIds.size !== speakers.length) {
    throw new Error('Voice analysis response contains duplicate speaker IDs.')
  }

  const segments = value.segments.map((entry): TranscriptSegment => {
    if (!isRecord(entry)) throw new Error('Voice analysis response contains an invalid transcript segment.')
    const id = requiredString(entry, 'id')
    const start_ms = timestamp(entry.start_ms, 'start_ms')
    const end_ms = timestamp(entry.end_ms, 'end_ms')
    if (end_ms < start_ms) throw new Error(`Transcript segment "${id}" ends before it starts.`)
    const speaker_id = nullableString(entry, 'speaker_id')
    if (speaker_id !== null && !speakerIds.has(speaker_id)) {
      throw new Error(`Transcript segment "${id}" references an unknown speaker.`)
    }
    return { id, start_ms, end_ms, speaker_id, text: requiredString(entry, 'text') }
  })
  const segmentIds = new Set(segments.map((segment) => segment.id))
  if (segmentIds.size !== segments.length) {
    throw new Error('Voice analysis response contains duplicate transcript segment IDs.')
  }

  const candidate_tasks = value.candidate_tasks.map((entry): CandidateTask => {
    if (!isRecord(entry)) throw new Error('Voice analysis response contains an invalid task candidate.')
    const deadline_iso = nullableString(entry, 'deadline_iso')
    if (deadline_iso !== null && !isIsoDateTime(deadline_iso)) {
      throw new Error('Voice analysis response contains an invalid normalized deadline.')
    }
    const deadline_text = nullableString(entry, 'deadline_text')
    if (deadline_iso !== null && deadline_text === null) {
      throw new Error('Voice analysis response contains a normalized deadline without spoken deadline text.')
    }
    const owner_speaker_id = nullableString(entry, 'owner_speaker_id')
    if (owner_speaker_id !== null && !speakerIds.has(owner_speaker_id)) {
      throw new Error('Voice analysis response contains a task owner with an unknown speaker ID.')
    }
    if (!Array.isArray(entry.evidence_segment_ids) ||
      !entry.evidence_segment_ids.every((id): id is string => typeof id === 'string')) {
      throw new Error('Voice analysis response contains invalid evidence segment IDs.')
    }
    if (!entry.evidence_segment_ids.every((id) => segmentIds.has(id))) {
      throw new Error('Voice analysis response references evidence that is not in the transcript.')
    }
    const confidence = entry.confidence
    if (confidence !== undefined &&
      (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
      throw new Error('Voice analysis response contains an invalid confidence score.')
    }
    if (entry.needs_review !== true) {
      throw new Error('Voice analysis response contains an invalid needs_review field.')
    }

    return {
      id: requiredString(entry, 'id'),
      title: requiredString(entry, 'title'),
      description: typeof entry.description === 'string' ? entry.description : '',
      owner_speaker_id,
      deadline_text,
      deadline_iso,
      evidence_segment_ids: entry.evidence_segment_ids,
      ...(confidence !== undefined && { confidence }),
      needs_review: entry.needs_review,
    }
  })
  if (new Set(candidate_tasks.map((candidate) => candidate.id)).size !== candidate_tasks.length) {
    throw new Error('Voice analysis response contains duplicate task candidate IDs.')
  }

  return {
    meeting_id: requiredString(value, 'meeting_id'),
    speakers,
    segments: [...segments].sort((first, second) => first.start_ms - second.start_ms),
    candidate_tasks,
  }
}

function errorMessageFromResponse(value: unknown, status: number): string {
  if (!isRecord(value) || !isRecord(value.error)) {
    return `Meeting analysis failed (HTTP ${status}). Please try again.`
  }

  const code = typeof value.error.code === 'string' ? value.error.code.trim() : ''
  const message = typeof value.error.message === 'string' ? value.error.message.trim() : ''
  const statusAndCode = code
    ? `${status} ${code.replace(new RegExp(`^${status}\\s*`), '')}`
    : `HTTP ${status}`

  if (message) return `${statusAndCode}: ${message}`
  if (code) return statusAndCode
  return `Meeting analysis failed (HTTP ${status}). Please try again.`
}

export async function analyzeMeeting(file: File, context: MeetingContext = {}): Promise<MeetingAnalysis> {
  const body = new FormData()
  body.append('file', file)
  if (context.meetingDate) body.append('meeting_date', context.meetingDate)
  if (context.timezone) body.append('timezone', context.timezone)

  let response: Response
  try {
    response = await fetch('/api/voice/analyze-meeting', { method: 'POST', body })
  } catch (error) {
    throw new Error(error instanceof Error
      ? `Could not reach the voice analysis service: ${error.message}`
      : 'Could not reach the voice analysis service.')
  }

  const responseBody: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    throw new Error(errorMessageFromResponse(responseBody, response.status))
  }
  return parseMeetingAnalysis(responseBody)
}
