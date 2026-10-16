/** Gated menu areas the super admin can unlock per collection. */
export const MENU_ITEMS = [
  { key: "holders_chat", label: "Holders Chat", to: "/feed" },
  { key: "conference_rooms", label: "Conference Rooms", to: "/rooms" },
  { key: "punks_brunch", label: "Punks Brunch", to: "/punks-brunch" },
  { key: "ape_rides", label: "Ape Rides", to: "/ape-rides" },
  { key: "event_stream", label: "Event Stream", to: "/event-stream" },
] as const;

export type MenuItemKey = (typeof MENU_ITEMS)[number]["key"];

export const MENU_ITEM_KEYS = MENU_ITEMS.map((i) => i.key) as MenuItemKey[];

/** Which gated area a path belongs to (for the verified-route guard). */
export function areaForPath(path: string): MenuItemKey | null {
  if (path.startsWith("/feed")) return "holders_chat";
  if (path.startsWith("/rooms") || path.startsWith("/calendar")) return "conference_rooms";
  if (path.startsWith("/punks-brunch")) return "punks_brunch";
  if (path.startsWith("/ape-rides")) return "ape_rides";
  if (path.startsWith("/event-stream")) return "event_stream";
  return null;
}
