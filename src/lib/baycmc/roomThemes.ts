// Conference-room theme → background image map.
//
// Each themed room references a file in `/public`. The card thumbnail in the
// /rooms grid and the room-page background both pull from this same map so
// the visual identity stays consistent between browse and in-room views.

export type RoomTheme =
  | "conservatory"
  | "garden"
  | "cigar"
  | "helipad"
  | "cellar"
  | "library"
  | "marina"
  | "pool-deck"
  | "studio-a"
  | "studio-b"
  | "game-room";

const THEME_IMAGE: Record<RoomTheme, string> = {
  conservatory: "/cam.png",
  garden: "/garden.png",
  cigar: "/bar.png",
  helipad: "/heli.png",
  cellar: "/hallway.png",
  library: "/office.png",
  marina: "/boat.png",
  "pool-deck": "/pool.png",
  "studio-a": "/studio.png",
  "studio-b": "/mic.png",
  "game-room": "/gameroom.png",
};

const THEME_AMBIENCE: Record<RoomTheme, string> = {
  conservatory: "Observatory · starlit dome",
  garden: "Garden · open-air greenery",
  cigar: "Smoker's lounge · leather & low light",
  helipad: "Rooftop helipad · skyline at dusk",
  cellar: "Wine cellar · vaulted brick passage",
  library: "Library · floor-to-ceiling shelves",
  marina: "Marina · yachts at twilight",
  "pool-deck": "Pool deck · palms after dark",
  "studio-a": "Studio A · foam walls, live mic",
  "studio-b": "Studio B · blue-lit booth",
  "game-room": "Game room · PvP arcade",
};

export function getRoomThemeImage(theme: string | null | undefined): string | null {
  if (!theme) return null;
  return THEME_IMAGE[theme as RoomTheme] ?? null;
}

export function getRoomThemeAmbience(theme: string | null | undefined): string | null {
  if (!theme) return null;
  return THEME_AMBIENCE[theme as RoomTheme] ?? null;
}
