// @vitest-environment jsdom
/**
 * Every mic control (room bottom bar, preferences panel, karaoke machine)
 * must read and write ONE shared preference — they used to keep separate
 * copies and fight each other.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/lib/auth/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";

describe("useRoomPreferences", () => {
  it("keeps all callers in sync", () => {
    const a = renderHook(() => useRoomPreferences());
    const b = renderHook(() => useRoomPreferences());
    const start = a.result.current.prefs.micEnabled;
    act(() => a.result.current.setPrefs({ micEnabled: !start }));
    expect(a.result.current.prefs.micEnabled).toBe(!start);
    expect(b.result.current.prefs.micEnabled).toBe(!start);
    act(() => b.result.current.setPrefs({ micEnabled: start }));
    expect(a.result.current.prefs.micEnabled).toBe(start);
    expect(JSON.parse(window.localStorage.getItem("baycmc:room-prefs:u1") ?? "{}").micEnabled).toBe(
      start,
    );
  });
});
