// @vitest-environment jsdom
/**
 * Regression: components whose auth state differs for a moment (one still
 * loading → user null, another already signed in) must not make the shared
 * store hand out a new object on every read — that caused an infinite render
 * loop ("Something went wrong") when a second member entered a karaoke room.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const g = globalThis as unknown as { __uid: string | null };
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ user: g.__uid ? { id: g.__uid } : null }),
}));

import { useRoomPreferences } from "@/lib/baycmc/useRoomPreferences";

function Probe({ uid }: { uid: string | null }) {
  g.__uid = uid;
  const { prefs } = useRoomPreferences();
  return <span>{String(prefs.micEnabled)}</span>;
}

describe("useRoomPreferences with mixed auth states", () => {
  it("renders signed-in and signed-out callers side by side without looping", () => {
    // Both users have SAVED prefs (fresh storage hands back the shared
    // DEFAULT object, which hid the bug).
    window.localStorage.setItem("baycmc:room-prefs:u1", JSON.stringify({ micEnabled: false }));
    window.localStorage.setItem("baycmc:room-prefs:anon", JSON.stringify({ micEnabled: true }));
    expect(() =>
      render(
        <>
          <Probe uid="u1" />
          <Probe uid={null} />
          <Probe uid="u1" />
        </>,
      ),
    ).not.toThrow();
  });
});
