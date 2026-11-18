/**
 * True while any audio/video element on the page is actually playing — a
 * theatre viewer or karaoke listener is present even without touching the
 * screen.
 */
export function isMediaPlaying(root: Pick<Document, "querySelectorAll"> = document): boolean {
  const els = root.querySelectorAll<HTMLMediaElement>("audio, video");
  for (const el of Array.from(els)) {
    if (!el.paused && !el.ended && el.readyState > 2) return true;
  }
  return false;
}
