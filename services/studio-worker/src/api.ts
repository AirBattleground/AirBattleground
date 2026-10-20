/** The worker's one API call: POST /api/studio-worker/poll (header X-Worker-Key). */
import type { WorkerPollInput, WorkerPollResponse } from "@7xen/shared";

export type PollResult =
  | { kind: "ok"; res: WorkerPollResponse }
  | { kind: "unauthorized" }
  /** network error, timeout, 5xx, or anything unexpected — try again */
  | { kind: "error"; message: string };

export type Poll = (body: WorkerPollInput) => Promise<PollResult>;

export function makePoll(apiUrl: string, workerKey: string, timeoutMs = 10_000): Poll {
  return async (body) => {
    try {
      const res = await fetch(`${apiUrl}/api/studio-worker/poll`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Worker-Key": workerKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 401) return { kind: "unauthorized" };
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { kind: "error", message: `API answered ${res.status} ${text.slice(0, 200)}` };
      }
      return { kind: "ok", res: (await res.json()) as WorkerPollResponse };
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      return { kind: "error", message: `${e.message}${e.cause?.code ? ` (${e.cause.code})` : ""}` };
    }
  };
}
