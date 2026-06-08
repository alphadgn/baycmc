import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E coverage for premium-room device permissions + host controls.
 *
 * 1. App must request audio/video device permissions when the user joins a
 *    premium (Lifer) LiveKit room. We grant `microphone` + `camera`
 *    permissions on the browser context, install a `getUserMedia` mock so
 *    the test never depends on real hardware, and assert that the mock is
 *    invoked with both `audio: true` and `video: true` constraints during
 *    the pre-join / publish phase.
 *
 * 2. Once permissions are granted, the host's room controls must be
 *    operable and round-trip through the server fns:
 *      - "Mute all" / "Unmute all" toggle           → muteAllRoomParticipants
 *      - "Lock room" / "Unlock room" toggle         → setRoomLocked
 *    Both buttons are scoped to host-only UI (HostControlsPanel) and
 *    are only rendered when the LiveKit token mints with `isHost: true`.
 *
 * Optional env vars (skips cleanly when absent so CI stays green):
 *   BASE_URL                       — origin under test (default localhost:3000)
 *   HOST_STORAGE_STATE             — Playwright storageState JSON for a
 *                                    pre-authenticated host account that is
 *                                    a verified BAYC/MAYC + Otherpage Lifer
 *                                    holder and the active booking owner
 *                                    of the seeded Lifer room.
 *   PREMIUM_ROOM_PATH              — route to the premium room
 *                                    (default `/lifers/room`).
 */

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const HOST_STATE = process.env.HOST_STORAGE_STATE;
const ROOM_PATH = process.env.PREMIUM_ROOM_PATH ?? "/lifers/room";

type GumCall = { audio: boolean; video: boolean };

async function newHostContext(
  browser: Parameters<typeof test.use>[0] extends never
    ? never
    : Parameters<Parameters<typeof test>[1]>[0]["browser"],
): Promise<BrowserContext> {
  return browser.newContext({
    storageState: HOST_STATE,
    permissions: ["microphone", "camera"],
    // LiveKit checks the secure-origin requirement before prompting; the
    // preview is HTTPS so this is informational only.
    ignoreHTTPSErrors: true,
  });
}

/** Installs a deterministic getUserMedia stub and exposes a call log. */
async function installMediaMocks(page: Page) {
  await page.addInitScript(() => {
    type Call = { audio: boolean; video: boolean };
    const calls: Call[] = [];
    (window as unknown as { __gumCalls: Call[] }).__gumCalls = calls;

    const fakeTrack = (kind: "audio" | "video") =>
      ({
        kind,
        id: `${kind}-mock`,
        label: `Mock ${kind}`,
        enabled: true,
        muted: false,
        readyState: "live",
        stop() {
          this.readyState = "ended";
        },
        getSettings: () => ({ deviceId: `mock-${kind}` }),
        getConstraints: () => ({}),
        getCapabilities: () => ({}),
        applyConstraints: async () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
        clone() {
          return this;
        },
      }) as unknown as MediaStreamTrack;

    const fakeStream = (audio: boolean, video: boolean): MediaStream => {
      const tracks: MediaStreamTrack[] = [];
      if (audio) tracks.push(fakeTrack("audio"));
      if (video) tracks.push(fakeTrack("video"));
      const stream = {
        id: `stream-${Date.now()}`,
        active: true,
        getTracks: () => tracks,
        getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
        getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
        addTrack: () => undefined,
        removeTrack: () => undefined,
        clone() {
          return this;
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => true,
      } as unknown as MediaStream;
      return stream;
    };

    const md = (navigator.mediaDevices ??= {} as MediaDevices);
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const audio = !!constraints?.audio;
      const video = !!constraints?.video;
      calls.push({ audio, video });
      return fakeStream(audio, video);
    };
    md.enumerateDevices = async () => [
      {
        deviceId: "mock-audio",
        kind: "audioinput",
        label: "Mock Mic",
        groupId: "g1",
        toJSON: () => ({}),
      } as MediaDeviceInfo,
      {
        deviceId: "mock-video",
        kind: "videoinput",
        label: "Mock Cam",
        groupId: "g1",
        toJSON: () => ({}),
      } as MediaDeviceInfo,
      {
        deviceId: "mock-out",
        kind: "audiooutput",
        label: "Mock Speaker",
        groupId: "g1",
        toJSON: () => ({}),
      } as MediaDeviceInfo,
    ];
  });
}

test.describe("Premium room — device permissions + host controls", () => {
  test.skip(
    !HOST_STATE,
    "Set HOST_STORAGE_STATE to a Playwright storageState file for a verified host account to run this suite.",
  );

  test("getUserMedia is invoked with audio + video; host toggles round-trip", async ({
    browser,
  }) => {
    const context = await newHostContext(browser);
    const page = await context.newPage();
    await installMediaMocks(page);

    // 1. Navigate straight to the premium room. The `_verified` layout
    //    revalidates BAYC/MAYC + Otherpage at mount, so a successful
    //    landing already proves the premium-access unlock is in place.
    await page.goto(`${BASE_URL}${ROOM_PATH}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // 2. Pre-join controls render before the LiveKit room is live. Toggle
    //    mic + camera ON so LiveKit will publish both tracks once we join,
    //    which is what triggers getUserMedia.
    const micToggle = page.getByRole("button", { name: /^(Microphone|Mic) /i }).first();
    const camToggle = page.getByRole("button", { name: /^(Camera|Cam) /i }).first();
    if (await micToggle.count()) await micToggle.click().catch(() => undefined);
    if (await camToggle.count()) await camToggle.click().catch(() => undefined);

    // 3. Join the room.
    const join = page.getByRole("button", { name: /^(Join|Enter|Connect)/i }).first();
    await expect(join).toBeVisible({ timeout: 15_000 });
    await join.click();

    // 4. Wait until LiveKit has asked the browser for at least one
    //    audio+video stream. We poll the in-page call log the mock fills.
    await expect
      .poll(
        async () =>
          page.evaluate(() => (window as unknown as { __gumCalls?: GumCall[] }).__gumCalls ?? []),
        { timeout: 20_000, message: "navigator.mediaDevices.getUserMedia was never called" },
      )
      .toEqual(expect.arrayContaining([expect.objectContaining({ audio: true })]));

    const allCalls = await page.evaluate(
      () => (window as unknown as { __gumCalls?: GumCall[] }).__gumCalls ?? [],
    );
    expect(
      allCalls.some((c) => c.audio),
      "expected at least one audio permission request",
    ).toBeTruthy();
    expect(
      allCalls.some((c) => c.video),
      "expected at least one video permission request",
    ).toBeTruthy();

    // 5. Host controls must be present (proves the LiveKit token minted
    //    with `isHost: true` — i.e. the user is the active booking owner
    //    or an admin).
    const muteAll = page.getByRole("button", { name: /Mute all/i });
    const lockRoom = page.getByRole("button", { name: /Lock room/i });
    await expect(muteAll).toBeVisible({ timeout: 15_000 });
    await expect(lockRoom).toBeVisible();

    // 6. Mute all → button flips to "Unmute all"; assert the
    //    muteAllRoomParticipants server fn was hit successfully.
    const muteAllReq = page.waitForResponse(
      (r) => r.url().includes("/_serverFn/muteAllRoomParticipants") && r.status() === 200,
      { timeout: 15_000 },
    );
    await muteAll.click();
    await muteAllReq;
    await expect(page.getByRole("button", { name: /Unmute all/i })).toBeVisible({
      timeout: 10_000,
    });

    // 7. Lock room → button flips to "Unlock room"; assert setRoomLocked
    //    round-trips.
    const lockReq = page.waitForResponse(
      (r) => r.url().includes("/_serverFn/setRoomLocked") && r.status() === 200,
      { timeout: 15_000 },
    );
    await lockRoom.click();
    await lockReq;
    await expect(page.getByRole("button", { name: /Unlock room/i })).toBeVisible({
      timeout: 10_000,
    });

    // 8. Restore room state so the test is re-runnable.
    await page.getByRole("button", { name: /Unlock room/i }).click();
    await page.getByRole("button", { name: /Unmute all/i }).click();

    await context.close();
  });
});
