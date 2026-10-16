import { describe, expect, it } from "vitest";
import { areaForPath, MENU_ITEM_KEYS } from "@/lib/baycmc/menu-items";

describe("menu areas", () => {
  it("maps every gated page to its area", () => {
    expect(areaForPath("/feed")).toBe("holders_chat");
    expect(areaForPath("/rooms")).toBe("conference_rooms");
    expect(areaForPath("/rooms/abc")).toBe("conference_rooms");
    expect(areaForPath("/calendar")).toBe("conference_rooms");
    expect(areaForPath("/punks-brunch")).toBe("punks_brunch");
    expect(areaForPath("/ape-rides/123")).toBe("ape_rides");
    expect(areaForPath("/event-stream")).toBe("event_stream");
  });
  it("leaves ungated pages alone", () => {
    expect(areaForPath("/lobby")).toBeNull();
    expect(areaForPath("/karaoke")).toBeNull();
  });
  it("matches the database's allowed item keys", () => {
    expect(MENU_ITEM_KEYS).toEqual([
      "holders_chat",
      "conference_rooms",
      "punks_brunch",
      "ape_rides",
      "event_stream",
    ]);
  });
});
