/**
 * Finished karaoke takes waiting for the singer's decision.
 *
 * Performances are recorded locally while the singer is on stage but are
 * NEVER uploaded automatically: at the end of each performance the take is
 * parked here and <KaraokeSaveTakeDialog> asks "Save or discard?". Nothing
 * leaves the device unless the singer taps Save.
 *
 * Takes are also kept on the device (IndexedDB, see pendingTakesDb.ts) until
 * answered, so the question comes back after a reload or a closed tab. Each
 * take carries the singer's user id from the moment recording STARTED; the
 * prompt only ever shows a take to that same signed-in user.
 */
import { useMemo, useSyncExternalStore } from "react";
import { assessTake, type TakeEndReason, type TakeNote } from "@/lib/karaoke/takeLifecycle";
import {
  deleteDraft,
  deleteStoredTake,
  loadAbandonedDrafts,
  loadStoredTakes,
  putStoredTake,
  type StoredTake,
} from "@/lib/karaoke/pendingTakesDb";

export interface PendingTake {
  id: string;
  userId: string;
  roomId: string;
  blob: Blob;
  mime: string;
  durationMs: number;
  title: string | null;
  artist: string | null;
  youtubeId: string | null;
  backingTrackId: string | null;
  reservationId: string | null;
  generation: number;
  hasInstrumental: boolean;
  reason: TakeEndReason;
  note: TakeNote;
  createdAt: number;
  /** Brought back from the device after a reload / closed tab. */
  restored?: boolean;
}

let takes: readonly PendingTake[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function toStored(t: PendingTake): StoredTake {
  const { restored: _restored, ...rest } = t;
  return rest;
}

export function addPendingTake(take: PendingTake) {
  if (takes.some((t) => t.id === take.id)) return;
  takes = [...takes, take];
  emit();
  void putStoredTake(toStored(take)).then(() => deleteDraft(take.id));
}

export function removePendingTake(id: string) {
  void deleteStoredTake(id);
  void deleteDraft(id);
  const next = takes.filter((t) => t.id !== id);
  if (next.length === takes.length) return;
  takes = next;
  emit();
}

export function getPendingTakes() {
  return takes;
}

/** Any unanswered take from this user in this room (the stage waits for it). */
export function hasPendingTakeFor(userId: string | null, roomId: string): boolean {
  return !!userId && takes.some((t) => t.userId === userId && t.roomId === roomId);
}

/** Bring back this user's unanswered takes (and takes cut off by a closed tab). */
export async function restorePendingTakes(userId: string): Promise<void> {
  const stored = await loadStoredTakes(userId);
  const drafts = await loadAbandonedDrafts(userId);
  const found: PendingTake[] = stored.map((s) => ({
    ...s,
    reason: s.reason as TakeEndReason,
    note: (s.note as TakeNote) ?? null,
    restored: true,
  }));
  for (const { draft, blob } of drafts) {
    const durationMs = Math.max(0, draft.updatedAt - draft.startedAt);
    const { offer, note } = assessTake({ sizeBytes: blob.size, durationMs });
    if (!offer) {
      void deleteDraft(draft.id);
      continue;
    }
    const { startedAt: _s, updatedAt: _u, ...meta } = draft;
    const take: PendingTake = {
      ...meta,
      blob,
      durationMs,
      reason: "left",
      note,
      restored: true,
    };
    found.push(take);
    void putStoredTake(toStored(take)).then(() => deleteDraft(draft.id));
  }
  if (found.length === 0) return;
  const known = new Set(takes.map((t) => t.id));
  const fresh = found.filter((t) => !known.has(t.id)).sort((a, b) => a.createdAt - b.createdAt);
  if (fresh.length === 0) return;
  takes = [...takes, ...fresh];
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const EMPTY: readonly PendingTake[] = [];

/** Takes for the given signed-in user only (never another account's). */
export function usePendingTakes(userId: string | null | undefined): readonly PendingTake[] {
  const all = useSyncExternalStore(subscribe, getPendingTakes, () => EMPTY);
  return useMemo(() => (userId ? all.filter((t) => t.userId === userId) : EMPTY), [all, userId]);
}
