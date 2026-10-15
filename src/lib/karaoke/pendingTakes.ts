/**
 * Finished karaoke takes waiting for the singer's decision.
 *
 * Performances are recorded locally while the singer is on stage but are
 * NEVER uploaded automatically: at the end of each performance the take is
 * parked here and <KaraokeSaveTakeDialog> asks "Save or discard?". Nothing
 * leaves the device unless the singer taps Save.
 */
import { useSyncExternalStore } from "react";

export interface PendingTake {
  id: string;
  blob: Blob;
  mime: string;
  durationMs: number;
  title: string | null;
  artist: string | null;
  /** Uploads the take and creates the recording row. */
  save: () => Promise<void>;
}

let takes: readonly PendingTake[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function addPendingTake(take: PendingTake) {
  takes = [...takes, take];
  emit();
}

export function removePendingTake(id: string) {
  const next = takes.filter((t) => t.id !== id);
  if (next.length === takes.length) return;
  takes = next;
  emit();
}

export function getPendingTakes() {
  return takes;
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const EMPTY: readonly PendingTake[] = [];

export function usePendingTakes(): readonly PendingTake[] {
  return useSyncExternalStore(subscribe, getPendingTakes, () => EMPTY);
}
