/**
 * Shared contract for the Worker App ↔ UI App round-trip demo.
 *
 * Exercises BOTH directions of the offscreen channel end-to-end:
 *   - workerState  (Worker App → UI App state sync): the Worker writes mock
 *     data here; the UI App subscribes and renders it.
 *   - appEvents    (UI App → Worker App events): the UI App's "Refresh" button
 *     sends REFRESH_DEMO_EVENT; the Worker regenerates the mock data and writes
 *     it back to workerState, which the UI App then re-renders with new values.
 *
 * Keeping the key, event name, and shape here keeps both pages in lockstep.
 */

/** workerState key the Worker writes and the UI App subscribes to. */
export const DEMO_WORKER_STATE_KEY = 'demoWorkerData';

/** appEvents name the UI App sends to ask the Worker to regenerate the data. */
export const REFRESH_DEMO_EVENT = 'refresh-demo-data';

/** Mock payload the Worker syncs to the UI App via workerState. */
export interface DemoWorkerData {
  /** Increments on every (re)generation — proves the UI saw fresh data. */
  refreshCount: number;
  /** ISO timestamp of when the Worker generated this snapshot. */
  generatedAt: string;
  /** Random token — visibly changes on each refresh. */
  token: string;
  /** Human-readable summary. */
  message: string;
}

/**
 * Build a fresh mock payload. Pure given `refreshCount`; the timestamp/token
 * vary so the UI App can visually confirm the data was recreated.
 */
export function buildDemoWorkerData(refreshCount: number): DemoWorkerData {
  return {
    refreshCount,
    generatedAt: new Date().toISOString(),
    token: Math.random().toString(36).slice(2, 10),
    message: `Mock payload #${refreshCount} from Worker App`,
  };
}
