import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pictures posted in chats live in the private "chat-attachments" bucket.
 * Messages store the file's address; to show it we ask the server for a
 * short-lived signed link, which storage grants only to members who can read
 * the message the picture was posted in. Other addresses pass through as-is.
 */
const MARKER = "/chat-attachments/";
const TTL_S = 60 * 60;
const cache = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string | null>>();

export function chatAttachmentPath(url: string): string | null {
  const i = url.indexOf(MARKER);
  if (i < 0) return null;
  return decodeURIComponent(url.slice(i + MARKER.length).split("?")[0]);
}

async function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now() + 60_000) return hit.url;
  const inflight = pending.get(path);
  if (inflight) return inflight;
  const p = supabase.storage
    .from("chat-attachments")
    .createSignedUrl(path, TTL_S)
    .then(({ data }) => {
      pending.delete(path);
      if (!data?.signedUrl) return null;
      cache.set(path, { url: data.signedUrl, expires: Date.now() + TTL_S * 1000 });
      return data.signedUrl;
    });
  pending.set(path, p);
  return p;
}

/** Viewable address for a chat picture (null while loading or if not allowed). */
export function useChatImageUrl(url: string | null | undefined): string | null {
  const path = url ? chatAttachmentPath(url) : null;
  const [resolved, setResolved] = useState<string | null>(() =>
    !url ? null : path ? (cache.get(path)?.url ?? null) : url,
  );
  useEffect(() => {
    if (!url) {
      setResolved(null);
      return;
    }
    if (!path) {
      setResolved(url);
      return;
    }
    let cancelled = false;
    void signedUrl(path).then((u) => {
      if (!cancelled) setResolved(u);
    });
    return () => {
      cancelled = true;
    };
  }, [url, path]);
  return resolved;
}

export function ChatImage({
  url,
  linkClassName,
  imgClassName,
  alt = "attachment",
}: {
  url: string;
  linkClassName?: string;
  imgClassName?: string;
  alt?: string;
}) {
  const src = useChatImageUrl(url);
  if (!src) {
    return (
      <span
        className={`${linkClassName ?? ""} block h-24 w-40 animate-pulse rounded-lg bg-muted/30`}
        aria-label="Loading picture"
      />
    );
  }
  return (
    <a href={src} target="_blank" rel="noreferrer" className={linkClassName}>
      <img src={src} alt={alt} loading="lazy" className={imgClassName} />
    </a>
  );
}
