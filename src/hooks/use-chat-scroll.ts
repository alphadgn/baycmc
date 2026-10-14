import { useCallback, useEffect, useRef, useState } from "react";

/** Pin the newest messages through async history, media and viewport resizing, until scrolled away. */
export function useChatScroll(threadKey: string, ready: boolean, version: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastTop = useRef(0);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
    setShowJumpToBottom(false);
  }, []);

  useEffect(() => {
    pinned.current = true;
    lastTop.current = 0;
    setShowJumpToBottom(false);
  }, [threadKey, ready]);

  useEffect(() => {
    if (!ready) return;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const keepLatest = () => {
      if (pinned.current) scrollToBottom();
    };
    keepLatest();
    const frame = requestAnimationFrame(keepLatest);
    const observer = new ResizeObserver(keepLatest);
    observer.observe(el);
    observer.observe(content);
    content.addEventListener("load", keepLatest, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      content.removeEventListener("load", keepLatest, true);
    };
  }, [threadKey, ready, version, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    // Content growing below us must not be mistaken for scrolling up.
    if (near) pinned.current = true;
    else if (el.scrollTop < lastTop.current) pinned.current = false;
    lastTop.current = el.scrollTop;
    setShowJumpToBottom(!pinned.current && !near);
  }, []);

  return { scrollRef, contentRef, handleScroll, scrollToBottom, showJumpToBottom };
}
