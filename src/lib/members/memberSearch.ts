import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Member lookup by username (database-backed: rpc search_members, signed-in
 * members only, public profile fields only). Usernames may contain spaces,
 * so mentions are matched against the directory of real usernames rather
 * than a single-word pattern.
 */
export interface MemberHit {
  id: string;
  username: string;
  avatar_url: string | null;
  wallet_display: string | null;
}

export async function searchMembers(q: string, limit = 8): Promise<MemberHit[]> {
  const { data, error } = await supabase.rpc("search_members", { _q: q, _limit: limit });
  if (error) return [];
  return (data ?? []) as MemberHit[];
}

/** Debounced database search; empty text returns nothing unless `listAll`. */
export function useMemberSearch(q: string, enabled = true, limit = 8, listAll = false) {
  const [hits, setHits] = useState<MemberHit[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || (!q.trim() && !listAll)) {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      void searchMembers(q, limit).then((r) => {
        if (cancelled) return;
        setHits(r);
        setLoading(false);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, enabled, limit, listAll]);
  return { hits, loading };
}

// ── Directory (for rendering mentions) ─────────────────────────────────────
let directory: MemberHit[] | null = null;
let directoryPromise: Promise<MemberHit[]> | null = null;
const listeners = new Set<() => void>();

function loadDirectory(force = false) {
  if (!force && (directory || directoryPromise)) return directoryPromise;
  directoryPromise = searchMembers("", 500).then((r) => {
    directory = r;
    directoryPromise = null;
    listeners.forEach((l) => l());
    return r;
  });
  return directoryPromise;
}

/** Every member username (cached for the session). */
export function useMemberDirectory(): MemberHit[] {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    void loadDirectory();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return directory ?? [];
}

/** Remember a member picked from search so their mention renders at once. */
export function rememberMember(m: MemberHit) {
  if (!directory) directory = [];
  if (!directory.some((d) => d.id === m.id)) {
    directory = [...directory, m];
    listeners.forEach((l) => l());
  }
}

// ── Mention parsing ────────────────────────────────────────────────────────

/**
 * The "@partial" the caret is in, if any: text after the last "@" before
 * the caret, on the same line, starting at a word boundary.
 */
export function mentionAtCaret(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && /[\w@]/.test(before[at - 1]!)) return null; // e.g. emails
  const query = before.slice(at + 1);
  if (query.length > 32 || /[\n\r]/.test(query) || /^\s/.test(query)) return null;
  return { start: at, query };
}

/** Replace the "@partial" with "@username " and return the new caret. */
export function applyMention(text: string, start: number, caret: number, username: string) {
  const insert = `@${username} `;
  const next = text.slice(0, start) + insert + text.slice(caret).replace(/^ /, "");
  return { text: next, caret: start + insert.length };
}

export type MentionPart =
  { kind: "text"; text: string } | { kind: "mention"; text: string; member: MemberHit };

/**
 * Split a message into text and @mentions of real members (longest
 * username wins, case-insensitive, must end at a word boundary).
 */
export function splitMentions(body: string, members: MemberHit[]): MentionPart[] {
  if (!body.includes("@") || members.length === 0) return [{ kind: "text", text: body }];
  const sorted = [...members].sort((a, b) => b.username.length - a.username.length);
  const lower = body.toLowerCase();
  const parts: MentionPart[] = [];
  let i = 0;
  let last = 0;
  while ((i = body.indexOf("@", i)) >= 0) {
    if (i > 0 && /[\w@]/.test(body[i - 1]!)) {
      i++;
      continue;
    }
    const rest = lower.slice(i + 1);
    const hit = sorted.find((m) => {
      const u = m.username.toLowerCase();
      if (!rest.startsWith(u)) return false;
      const after = rest[u.length];
      return after === undefined || !/[\w]/.test(after);
    });
    if (!hit) {
      i++;
      continue;
    }
    if (i > last) parts.push({ kind: "text", text: body.slice(last, i) });
    const len = 1 + hit.username.length;
    parts.push({ kind: "mention", text: body.slice(i, i + len), member: hit });
    i += len;
    last = i;
  }
  if (last < body.length) parts.push({ kind: "text", text: body.slice(last) });
  return parts;
}
