// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatScroll } from "@/hooks/use-chat-scroll";

let resized: () => void;
function Thread({ name = "first", ready = true, count = 1 }) {
  const { scrollRef, contentRef, handleScroll } = useChatScroll(name, ready, count);
  return (
    <div ref={scrollRef} onScroll={handleScroll} data-testid="viewport">
      <div ref={contentRef}>{count}</div>
    </div>
  );
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    callback();
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Newest-message opening", () => {
  it("waits for history, follows late media, and resets on thread switches", () => {
    const view = render(<Thread ready={false} />);
    const el = view.getByTestId("viewport");
    let height = 1000;
    Object.defineProperties(el, {
      scrollHeight: { get: () => height },
      clientHeight: { get: () => 200 },
    });
    view.rerender(<Thread ready />);
    expect(el.scrollTop).toBe(1000);
    height = 1500;
    act(() => resized());
    expect(el.scrollTop).toBe(1500);
    act(() => {
      el.scrollTop = 100;
      el.dispatchEvent(new Event("scroll"));
    });
    height = 2000;
    act(() => resized());
    expect(el.scrollTop).toBe(100);
    view.rerender(<Thread name="second" ready />);
    expect(el.scrollTop).toBe(2000);
  });
});
