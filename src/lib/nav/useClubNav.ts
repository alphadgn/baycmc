import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { useMenuItems } from "@/lib/baycmc/useMenuItems";
import { useMudwaterAccess } from "@/lib/mudwater/useMudwaterAccess";

/**
 * The clubhouse menu, shared by the header menu and the rooms sidebar.
 *
 *  - Not signed in: nothing.
 *  - Signed in, no verified collections: Public Lobby, Karaoke, Mudwater,
 *    Profile, Support.
 *  - Holders: those plus only what their collections open this session
 *    (Super Admin → Menu access matrix + each room's collection list), with
 *    rooms grouped under "Conference Rooms" in the club's order.
 *  - Mudwater shows to every signed-in member; without a wallet sign-in it
 *    is greyed out and opens the wallet sign-in.
 *  - Game Room and Ape Rides are greyed out ("coming soon"; Ape Rides is
 *    open to admins).
 */
export type NavLeaf = {
  kind: "link";
  key: string;
  label: string;
  to: string;
  params?: Record<string, string>;
  tone?: "gold";
  /** Greyed out; tapping shows a note or opens wallet sign-in instead. */
  disabled?: "coming_soon" | "wallet" | "lifer";
};
export type NavGroup = { kind: "group"; key: string; label: string; children: NavLeaf[] };
export type NavEntry = NavLeaf | NavGroup;

type RoomRow = {
  id: string;
  name: string;
  kind: string;
  tier: string;
  display_order: number | null;
  coming_soon: boolean;
  required_collection: string | null;
};

export function useClubNav(): NavEntry[] {
  const { isAuthenticated, user } = useAuth();
  const v = useVerificationStatus();
  const areas = useMenuItems();
  const mudwaterOk = useMudwaterAccess();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [chapters, setChapters] = useState<{ id: string; name: string }[] | null>(null);
  const userId = user?.id ?? null;
  const collectionsKey = v.collections.join(",");

  useEffect(() => {
    if (!userId) {
      setRooms([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      void supabase
        .from("rooms")
        .select("id,name,kind,tier,display_order,coming_soon,required_collection")
        .eq("active", true)
        .in("kind", ["karaoke", "conference", "game"])
        .order("display_order", { ascending: true, nullsFirst: false })
        .order("name")
        .then(({ data }) => {
          if (!cancelled) setRooms((data ?? []) as RoomRow[]);
        });
    // Local Chapters: verified BAYC / MAYC / CryptoPunks holders and staff.
    const loadChapters = () =>
      void supabase.rpc("chapter_viewer", { _uid: userId }).then(async ({ data: ok }) => {
        if (cancelled) return;
        if (ok !== true) {
          setChapters(null);
          return;
        }
        const { data } = await supabase
          .from("local_chapters")
          .select("id,name")
          .eq("active", true)
          .order("display_order")
          .order("name");
        if (!cancelled) setChapters(data ?? []);
      });
    load();
    loadChapters();
    window.addEventListener("baycmc:verification-refresh", load);
    window.addEventListener("baycmc:verification-refresh", loadChapters);
    window.addEventListener("baycmc:chapters-changed", loadChapters);
    return () => {
      cancelled = true;
      window.removeEventListener("baycmc:verification-refresh", load);
      window.removeEventListener("baycmc:verification-refresh", loadChapters);
      window.removeEventListener("baycmc:chapters-changed", loadChapters);
    };
  }, [userId, collectionsKey]);

  if (!isAuthenticated) return [];

  const isAdmin = v.isAdmin;
  const isSuperAdmin = v.roles.includes("super_admin");
  const karaoke = rooms.find((r) => r.kind === "karaoke");
  const karaokeLeaf: NavLeaf = karaoke
    ? {
        kind: "link",
        key: "karaoke",
        label: "Karaoke Room",
        to: "/karaoke/$roomId",
        params: { roomId: karaoke.id },
      }
    : { kind: "link", key: "karaoke", label: "Karaoke Room", to: "/karaoke" };
  const mudwaterLeaf: NavLeaf = {
    kind: "link",
    key: "mudwater",
    label: "Mudwater",
    to: "/mudwater",
    ...(mudwaterOk ? {} : { disabled: "wallet" as const }),
  };

  // Collection rooms this member may enter (row-level security already
  // limited the list). Lifer rooms live elsewhere; Game Room is appended.
  const collectionRooms = rooms.filter((r) => r.kind === "conference" && r.tier !== "lifer");
  const gameRoom = rooms.find((r) => r.kind === "game");

  const entries: NavEntry[] = [{ kind: "link", key: "lobby", label: "Public Lobby", to: "/lobby" }];
  if (isAdmin || areas.has("holders_chat")) {
    entries.push({ kind: "link", key: "holders", label: "Holders Chat", to: "/feed" });
  }
  if (collectionRooms.length > 0) {
    const children: NavLeaf[] = [karaokeLeaf, mudwaterLeaf];
    for (const r of collectionRooms) {
      children.push(
        r.required_collection === "PUNKS"
          ? { kind: "link", key: r.id, label: r.name, to: "/punks-brunch" }
          : {
              kind: "link",
              key: r.id,
              label: r.name,
              to: "/rooms/$roomId",
              params: { roomId: r.id },
            },
      );
    }
    if (gameRoom) {
      children.push({
        kind: "link",
        key: gameRoom.id,
        label: gameRoom.name,
        to: "/rooms/$roomId",
        params: { roomId: gameRoom.id },
        ...(gameRoom.coming_soon ? { disabled: "coming_soon" as const } : {}),
      });
    }
    entries.push({ kind: "group", key: "conference", label: "Conference Rooms", children });
  } else {
    entries.push(karaokeLeaf, mudwaterLeaf);
  }
  if (chapters) {
    // Chapter names (super admin's list), booking, and the Lifer room (the
    // Cellar) greyed at the bottom — open only to granted Lifers.
    const children: NavLeaf[] = chapters.map((c) => ({
      kind: "link",
      key: `chapter-${c.id}`,
      label: c.name,
      to: "/chapters/$chapterId",
      params: { chapterId: c.id },
    }));
    children.push({
      kind: "link",
      key: "chapter-book",
      label: "Book a local chapter meeting",
      to: "/chapters/book",
      tone: "gold",
    });
    children.push({
      kind: "link",
      key: "lifer-room",
      label: "Lifer Room (Cellar)",
      to: "/lifers/room",
      ...(v.isLifer ? {} : { disabled: "lifer" as const }),
    });
    entries.push({ kind: "group", key: "chapters", label: "Local Chapters", children });
  }
  if (v.isLifer) {
    entries.push({
      kind: "link",
      key: "lifer-chat",
      label: "Lifer Chat",
      to: "/lifers/messages",
      tone: "gold",
    });
  }
  if (isAdmin || areas.has("event_stream")) {
    entries.push({ kind: "link", key: "event-stream", label: "Event Stream", to: "/event-stream" });
  }
  if (isAdmin || areas.has("ape_rides")) {
    entries.push({
      kind: "link",
      key: "ape-rides",
      label: "Ape Rides",
      to: "/ape-rides",
      ...(isAdmin ? {} : { disabled: "coming_soon" as const }),
    });
  }
  entries.push(
    { kind: "link", key: "profile", label: "Profile", to: "/profile" },
    { kind: "link", key: "support", label: "Support", to: "/support" },
  );
  if (isAdmin)
    entries.push({
      kind: "link",
      key: "admin",
      label: "Administrator",
      to: "/admin",
      tone: "gold",
    });
  if (isSuperAdmin) {
    entries.push({
      kind: "link",
      key: "super-admin",
      label: "Super Admin",
      to: "/super-admin",
      tone: "gold",
    });
  }
  return entries;
}

/** What a greyed-out entry does when tapped. */
export function onDisabledNav(
  leaf: NavLeaf,
  toast: (msg: string, opts?: { duration?: number }) => void,
) {
  if (leaf.disabled === "wallet") {
    // Opens the wallet sign-in (AppHeader listens and opens the dialog).
    window.dispatchEvent(new Event("baycmc:link-wallet-open"));
  } else if (leaf.disabled === "coming_soon") {
    toast("Coming soon", { duration: 2000 });
  } else if (leaf.disabled === "lifer") {
    toast("The Lifer room is open to members granted Lifer access.", { duration: 2500 });
  }
}
