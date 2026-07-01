/** The three BullMQ queues whose recent jobs the dashboard surfaces. */
export type JobQueueName = 'weather' | 'reports' | 'stations-import';

/** BullMQ lifecycle states we expose (collapsed from getState()'s full set). */
export type JobState =
  | 'active'
  | 'completed'
  | 'failed'
  | 'waiting'
  | 'delayed'
  | 'paused'
  | 'unknown';

/**
 * One recent background job, flattened from a BullMQ Job across all queues.
 * The frontend's "Tác vụ nền gần đây" panel renders these directly — it maps
 * `queue` → a Vietnamese label and `state` → a status badge.
 */
export interface RecentJob {
  id: string;
  queue: JobQueueName;
  /** The BullMQ job name (e.g. 'ingest', 'render', 'import'). */
  name: string;
  state: JobState;
  /** Numeric progress 0–100 (0 when the processor reports non-numeric progress). */
  progress: number;
  attemptsMade: number;
  /** ISO timestamps; null when BullMQ hasn't reached that lifecycle point yet. */
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Failure message when state is 'failed'. */
  failedReason: string | null;
}
