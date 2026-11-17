import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getParticipant: vi.fn(),
  listParticipants: vi.fn(),
  updateParticipant: vi.fn(),
  removeParticipant: vi.fn(),
}));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock("livekit-server-sdk", () => ({
  RoomServiceClient: class {
    getParticipant = mocks.getParticipant;
    listParticipants = mocks.listParticipants;
    updateParticipant = mocks.updateParticipant;
    removeParticipant = mocks.removeParticipant;
  },
}));
import { authorizeBroadcast, reconcileStreamPublishers } from "@/server/stream-grants.server";

describe("stream media authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("LIVEKIT_API_KEY", "isolated-test");
    vi.stubEnv("LIVEKIT_API_SECRET", "isolated-test");
    vi.stubEnv("LIVEKIT_URL", "https://isolated.invalid");
    mocks.getParticipant.mockResolvedValue({
      sid: "connection",
      identity: "member",
      metadata: JSON.stringify({ streamSession: "session", broadcastId: "broadcast" }),
    });
    mocks.listParticipants.mockResolvedValue([{ identity: "member" }]);
    mocks.updateParticipant.mockResolvedValue({});
  });
  it("failed grant claim never enables publishing", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect(await authorizeBroadcast("member", "session", "broadcast", "connection", true)).toBe(
      false,
    );
    expect(mocks.updateParticipant).toHaveBeenCalledWith(
      "event-stream",
      "member",
      expect.objectContaining({ permission: expect.objectContaining({ canPublish: false }) }),
    );
  });
  it("different signed-in session cannot claim or change media permissions", async () => {
    expect(
      await authorizeBroadcast("member", "other-session", "broadcast", "connection", true),
    ).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateParticipant).not.toHaveBeenCalled();
  });
  it("revocation racing Start demotes publishing after the final authorization check", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    expect(await authorizeBroadcast("member", "session", "broadcast", "connection", true)).toBe(
      false,
    );
    expect(mocks.updateParticipant).toHaveBeenLastCalledWith(
      "event-stream",
      "member",
      expect.objectContaining({ permission: expect.objectContaining({ canPublish: false }) }),
    );
  });
  it("scheduler removes expired connected publisher if permission revocation fails", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    mocks.listParticipants.mockResolvedValue([
      {
        identity: "member",
        permission: { canPublish: true },
        metadata: JSON.stringify({ streamSession: "session", broadcastId: "broadcast" }),
      },
    ]);
    mocks.updateParticipant.mockRejectedValue(new Error("isolated media error"));
    await reconcileStreamPublishers();
    expect(mocks.removeParticipant).toHaveBeenCalledWith("event-stream", "member");
  });
});
