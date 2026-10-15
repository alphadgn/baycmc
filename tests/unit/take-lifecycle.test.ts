import { describe, expect, it } from "vitest";
import { shouldKeepRecording } from "@/lib/karaoke/takeLifecycle";

describe("karaoke take lifecycle", () => {
  const live = { active: true, recordingEnabled: true, songKey: "7:abc" };
  it("keeps recording through mic mute / pause / off-air (not inputs)", () => {
    expect(shouldKeepRecording(live)).toBe(true);
  });
  it("ends the take only when the performance ends", () => {
    expect(shouldKeepRecording({ ...live, songKey: null })).toBe(false); // Stop
    expect(shouldKeepRecording({ ...live, active: false })).toBe(false); // turn over / left
    expect(shouldKeepRecording({ ...live, recordingEnabled: false })).toBe(false);
  });
});
