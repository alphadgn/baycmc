/**
 * Singleton transaction queue.
 *
 * Privy embedded wallets do not safely support concurrent signing — multiple
 * parallel signMessage / sendTransaction calls race the iframe and frequently
 * resolve out of order or drop. We serialize every wallet-bound RPC through a
 * single FIFO queue and add bounded retry with exponential backoff for
 * transient RPC failures (network blips, 429s, nonce stale, replacement
 * underpriced).
 *
 * All operations log structured events via logEvent() so /diagnostics shows
 * exactly which step failed and why.
 */
import { logEvent } from "@/lib/diagnostics";
import type { EthereumProviderLike } from "@/lib/wallet/useWallet";

export interface QueueRequestOptions {
  /** Human-readable label surfaced in /diagnostics. */
  label?: string;
  /** Max retry attempts on transient errors. Default 3. */
  maxAttempts?: number;
}

interface QueueJob<T> {
  run: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  label: string;
  maxAttempts: number;
}

const queue: Array<QueueJob<unknown>> = [];
let running = false;
let queueDepthHigh = 0;

function transientError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("timeout") ||
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("nonce") ||
    msg.includes("replacement") ||
    msg.includes("underpriced") ||
    msg.includes("temporarily")
  );
}

function userRejected(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("user rejected") || msg.includes("user denied");
}

async function backoff(attempt: number): Promise<void> {
  // 500ms, 1.5s, 4.5s
  const delay = 500 * Math.pow(3, Math.max(0, attempt - 1));
  await new Promise((r) => setTimeout(r, delay));
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const job = queue.shift()!;
    let attempt = 0;
    let lastErr: unknown = null;
    let succeeded = false;
    while (attempt < job.maxAttempts) {
      attempt += 1;
      try {
        logEvent("tx", "info", `${job.label} attempt`, { attempt, depth: queue.length });
        const out = await job.run();
        logEvent("tx", "info", `${job.label} resolved`, { attempt });
        job.resolve(out);
        succeeded = true;
        break;
      } catch (e) {
        lastErr = e;
        if (userRejected(e)) {
          logEvent("tx", "warn", `${job.label} user rejected`, { attempt });
          break; // do not retry user rejections
        }
        if (!transientError(e) || attempt >= job.maxAttempts) {
          logEvent("tx", "error", `${job.label} failed`, {
            attempt,
            error: e instanceof Error ? e.message : String(e),
          });
          break;
        }
        logEvent("tx", "warn", `${job.label} transient retry`, {
          attempt,
          error: e instanceof Error ? e.message : String(e),
        });
        await backoff(attempt);
      }
    }
    if (!succeeded) job.reject(lastErr ?? new Error("transaction failed"));
  }
  running = false;
}

function enqueue<T>(label: string, maxAttempts: number, run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({
      run: run as () => Promise<unknown>,
      resolve: resolve as (v: unknown) => void,
      reject,
      label,
      maxAttempts,
    });
    if (queue.length > queueDepthHigh) {
      queueDepthHigh = queue.length;
      logEvent("tx", "debug", "queue depth high-water", { depth: queueDepthHigh });
    }
    void pump();
  });
}

export function getQueueState() {
  return { depth: queue.length, running, highWater: queueDepthHigh };
}

export async function enqueueSign(
  provider: EthereumProviderLike,
  method: string,
  params: unknown[],
  opts?: QueueRequestOptions,
): Promise<unknown> {
  return enqueue(opts?.label ?? `sign:${method}`, opts?.maxAttempts ?? 3, () =>
    provider.request({ method, params }),
  );
}

export interface SendTxParams {
  from: string;
  to: string;
  value?: string; // hex
  data?: string; // hex
  gas?: string; // hex
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  chainId?: string;
}

export async function enqueueSend(
  provider: EthereumProviderLike,
  tx: SendTxParams,
  opts?: QueueRequestOptions,
): Promise<string> {
  const result = await enqueue(
    opts?.label ?? "send:eth_sendTransaction",
    opts?.maxAttempts ?? 3,
    () => provider.request({ method: "eth_sendTransaction", params: [tx] }),
  );
  if (typeof result !== "string") {
    throw new Error("Unexpected sendTransaction response");
  }
  return result;
}

/** Test-only: drain the queue (useful between Vitest runs). */
export function __resetQueueForTests() {
  queue.length = 0;
  running = false;
  queueDepthHigh = 0;
}
