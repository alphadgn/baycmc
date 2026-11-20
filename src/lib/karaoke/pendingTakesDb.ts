/**
 * On-device persistence for karaoke takes (IndexedDB), so an unanswered
 * "Save this performance?" survives a reload or a closed tab, and a take
 * cut off mid-song by closing the tab is offered on the next visit.
 *
 *  - `takes`  : finished takes waiting for Save / Discard (blob included)
 *  - `drafts` : takes still recording (metadata; updated with every chunk)
 *  - `chunks` : the recorder's 1-second chunks for each draft
 *
 * Nothing here ever leaves the device; only Save uploads. Every call is
 * best-effort: private browsing / quota errors fall back to memory only.
 */
const DB_NAME = "baycmc-karaoke";
const DB_VERSION = 1;

export interface StoredTake {
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
  reason: string;
  note: string | null;
  createdAt: number;
}

export type DraftMeta = Omit<StoredTake, "blob" | "durationMs" | "reason" | "note"> & {
  startedAt: number;
  updatedAt: number;
};

interface ChunkRow {
  takeId: string;
  seq: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Drafts this tab is recording right now (never "restored" from under it). */
const liveDrafts = new Set<string>();
export function setDraftLive(id: string, live: boolean) {
  if (live) liveDrafts.add(id);
  else liveDrafts.delete(id);
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("takes")) {
            db.createObjectStore("takes", { keyPath: "id" }).createIndex("userId", "userId");
          }
          if (!db.objectStoreNames.contains("drafts")) {
            db.createObjectStore("drafts", { keyPath: "id" }).createIndex("userId", "userId");
          }
          if (!db.objectStoreNames.contains("chunks")) {
            db.createObjectStore("chunks", { keyPath: ["takeId", "seq"] }).createIndex(
              "takeId",
              "takeId",
            );
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
}

function all<T>(req: IDBRequest): Promise<T[]> {
  return new Promise((resolve) => {
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

async function run(stores: string[], fn: (tx: IDBTransaction) => void): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(stores, "readwrite");
    fn(tx);
    await done(tx);
  } catch {
    /* best effort */
  }
}

export function putStoredTake(t: StoredTake): Promise<void> {
  return run(["takes"], (tx) => tx.objectStore("takes").put(t));
}

export function deleteStoredTake(id: string): Promise<void> {
  return run(["takes"], (tx) => tx.objectStore("takes").delete(id));
}

export function putDraft(d: DraftMeta): Promise<void> {
  return run(["drafts"], (tx) => tx.objectStore("drafts").put(d));
}

export function appendDraftChunk(takeId: string, seq: number, blob: Blob): Promise<void> {
  return run(["chunks", "drafts"], (tx) => {
    tx.objectStore("chunks").put({ takeId, seq, blob } satisfies ChunkRow);
    const drafts = tx.objectStore("drafts");
    const get = drafts.get(takeId);
    get.onsuccess = () => {
      const d = get.result as DraftMeta | undefined;
      if (d) drafts.put({ ...d, updatedAt: Date.now() });
    };
  });
}

/** Drop a draft and its chunks (the finished take was stored or discarded). */
export function deleteDraft(takeId: string): Promise<void> {
  return run(["chunks", "drafts"], (tx) => {
    tx.objectStore("drafts").delete(takeId);
    const idx = tx.objectStore("chunks").index("takeId");
    const cur = idx.openKeyCursor(IDBKeyRange.only(takeId));
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return;
      tx.objectStore("chunks").delete(c.primaryKey);
      c.continue();
    };
  });
}

/** Finished takes for this user. */
export async function loadStoredTakes(userId: string): Promise<StoredTake[]> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(["takes"], "readonly");
    return await all<StoredTake>(tx.objectStore("takes").index("userId").getAll(userId));
  } catch {
    return [];
  }
}

/**
 * Drafts for this user that stopped receiving chunks (the tab that was
 * recording them is gone), with their audio stitched back together.
 * MediaRecorder timeslice chunks concatenate into one playable file.
 */
export async function loadAbandonedDrafts(
  userId: string,
  staleMs = 15_000,
): Promise<Array<{ draft: DraftMeta; blob: Blob }>> {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(["drafts", "chunks"], "readonly");
    const drafts = await all<DraftMeta>(tx.objectStore("drafts").index("userId").getAll(userId));
    const out: Array<{ draft: DraftMeta; blob: Blob }> = [];
    for (const d of drafts) {
      if (liveDrafts.has(d.id)) continue; // recording in this tab
      if (Date.now() - d.updatedAt < staleMs) continue; // still recording in another tab
      const tx2 = db.transaction(["chunks"], "readonly");
      const rows = await all<ChunkRow>(
        tx2.objectStore("chunks").index("takeId").getAll(IDBKeyRange.only(d.id)),
      );
      rows.sort((a, b) => a.seq - b.seq);
      out.push({
        draft: d,
        blob: new Blob(
          rows.map((r) => r.blob),
          { type: d.mime },
        ),
      });
    }
    return out;
  } catch {
    return [];
  }
}
