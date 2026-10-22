import type { MeetingAnalysis } from './voiceAnalysis'

// Synthetic content lets the review workflow be exercised without implying real transcription.
export const sampleMeetingAnalysis: MeetingAnalysis = {
  meeting_id: 'meeting_demo_001',
  speakers: [
    { speaker_id: 'SPEAKER_01', first_seen_ms: 0 },
    { speaker_id: 'SPEAKER_02', first_seen_ms: 4200 },
  ],
  segments: [
    {
      id: 'seg_001',
      start_ms: 0,
      end_ms: 2400,
      speaker_id: 'SPEAKER_01',
      text: 'We need to prepare the demo by Friday.',
    },
    {
      id: 'seg_002',
      start_ms: 4200,
      end_ms: 7100,
      speaker_id: 'SPEAKER_02',
      text: 'I can review the speaker mapping before then.',
    },
    {
      id: 'seg_003',
      start_ms: 8200,
      end_ms: 10900,
      speaker_id: 'SPEAKER_01',
      text: 'Let’s confirm the deadline once the recording is checked.',
    },
  ],
  candidate_tasks: [
    {
      id: 'candidate_001',
      title: 'Prepare the demo',
      description: 'Prepare the demo for submission.',
      owner_speaker_id: 'SPEAKER_01',
      deadline_text: 'by Friday',
      deadline_iso: null,
      evidence_segment_ids: ['seg_001'],
      confidence: 0.88,
      needs_review: true,
    },
    {
      id: 'candidate_002',
      title: 'Review the speaker mapping',
      description: 'Check that the meeting speakers are mapped to the right teammates.',
      owner_speaker_id: 'SPEAKER_02',
      deadline_text: null,
      deadline_iso: null,
      evidence_segment_ids: ['seg_002'],
      confidence: 0.74,
      needs_review: true,
    },
    {
      id: 'candidate_003',
      title: 'Confirm the recording deadline',
      description: 'Confirm a final deadline after reviewing the recording.',
      owner_speaker_id: null,
      deadline_text: 'once the recording is checked',
      deadline_iso: null,
      evidence_segment_ids: ['seg_003'],
      confidence: 0.62,
      needs_review: true,
    },
  ],
}
