import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamVisible } from "@/lib/baycmc/stream-visibility";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), labels: ["BAYC"] }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: mocks }));
// Isolated tests exercise server authorization without any shared database writes.
// eslint-disable-next-line no-restricted-imports
import { roomVisibleTo } from "@/server/room-visibility.server";

describe("global collection room visibility", () => {
  const room = { id: "room", kind: "conference", tier: "token_proof", required_collection: "BAYC" };
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.labels = ["BAYC"];
    const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.in.mockResolvedValue({ data: [{ collection_label: "BAYC" }], error: null });
    mocks.from.mockReturnValue(query);
    mocks.rpc.mockImplementation(async (name, args) => ({
      data:
        name === "room_visible" ||
        name === "can_access_area" ||
        (name === "holds_any_collection" &&
          args._labels.split(",").some((l: string) => mocks.labels.includes(l))),
      error: null,
    }));
  });
  it("hides pay-per-view without a ticket, but preserves free and paid viewing", () => {
    expect(streamVisible({ free: false, hasTicket: false })).toBe(false);
    expect(streamVisible({ free: true, hasTicket: false })).toBe(true);
    expect(streamVisible({ free: false, hasTicket: true })).toBe(true);
  });
  it("hides a stream even when the collection menu is enabled", async () => {
    expect(await roomVisibleTo("member", { ...room, kind: "stream" })).toBe(false);
  });
  it("requires the same collection to unlock the menu and match the room", async () => {
    mocks.labels = ["PUNKS"];
    expect(await roomVisibleTo("member", room)).toBe(false);
    mocks.labels = ["BAYC"];
    expect(await roomVisibleTo("member", room)).toBe(true);
  });
  it("preserves staff access to collection rooms", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    expect(await roomVisibleTo("staff", room)).toBe(true);
  });
  it("preserves public karaoke entry", async () => {
    expect(await roomVisibleTo("member", { ...room, kind: "karaoke", tier: "public" })).toBe(true);
  });
  it("fails closed when the authoritative visibility query fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect(await roomVisibleTo("member", room)).toBe(false);
  });
  it("Lifer access cannot be granted by a collection menu alone", async () => {
    expect(await roomVisibleTo("member", { ...room, tier: "lifer" })).toBe(false);
  });
});
