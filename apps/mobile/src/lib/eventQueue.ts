/**
 * Batches recording events (start / capture / pause / stop …) and sends them with
 * PATCH /api/manager/recordings/:id. Keeps events when the network is down and retries on the next flush.
 * Pure (send function injected) — unit tested.
 */
import type { RecordingEvent, RecordingEventInput } from "@7xen/shared";

export type QueuedEvent = { at: string; type: RecordingEvent["type"]; detail: string | null };
export type SendFn = (recordingId: string, body: RecordingEventInput) => Promise<unknown>;

export class RecordingEventQueue {
  private pending: QueuedEvent[] = [];
  private inflight: Promise<boolean> | null = null;

  constructor(
    readonly recordingId: string,
    private readonly send: SendFn,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get size() {
    return this.pending.length;
  }

  push(type: QueuedEvent["type"], detail: string | null = null) {
    this.pending.push({ at: this.now().toISOString(), type, detail: detail ? detail.slice(0, 300) : null });
    // the API takes at most 200 events per request; keep the newest if we've been offline a long time
    if (this.pending.length > 400) this.pending.splice(0, this.pending.length - 400);
  }

  /** Sends queued events (plus optional status fields). Resolves true when everything was delivered. */
  async flush(extra: Omit<RecordingEventInput, "events"> = {}): Promise<boolean> {
    if (this.inflight) await this.inflight.catch(() => false);
    const hasExtra = Object.keys(extra).length > 0;
    if (!this.pending.length && !hasExtra) return true;
    const batch = this.pending.splice(0, 200);
    this.inflight = this.send(this.recordingId, { ...extra, events: batch } as RecordingEventInput)
      .then(() => true)
      .catch(() => {
        this.pending.unshift(...batch); // try again next time
        return false;
      });
    const ok = await this.inflight;
    this.inflight = null;
    if (ok && this.pending.length) return this.flush();
    return ok;
  }
}
