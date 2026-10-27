// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { isEditableElement, useLockedPageScroll } from "@/hooks/useLockedPageScroll";

describe("useLockedPageScroll", () => {
  it("snaps the page back to the top when it drifts with no field focused", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const { unmount } = renderHook(() => useLockedPageScroll());
    scrollTo.mockClear();
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    unmount();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.unstubAllGlobals();
  });

  it("leaves the page alone while the user is typing", () => {
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const { unmount } = renderHook(() => useLockedPageScroll());
    scrollTo.mockClear();
    Object.defineProperty(window, "scrollY", { value: 120, configurable: true });
    window.dispatchEvent(new Event("scroll"));
    expect(scrollTo).not.toHaveBeenCalled();
    unmount();
    input.remove();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
    vi.unstubAllGlobals();
  });

  it("restores page scrolling when the page closes", () => {
    const { unmount } = renderHook(() => useLockedPageScroll());
    expect(document.documentElement.style.overflow).toBe("hidden");
    unmount();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("treats checkboxes as not editable", () => {
    const box = document.createElement("input");
    box.type = "checkbox";
    expect(isEditableElement(box)).toBe(false);
    expect(isEditableElement(document.createElement("textarea"))).toBe(true);
  });
});
