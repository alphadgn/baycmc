/**
 * Room hub — a slide-over panel for everything that isn't the live stage:
 * house rules, booking, recorded takes, and (for moderators) the admin panel.
 *
 * Replaces the old "Recent Takes" section that was rendered BELOW the
 * fixed full-screen RoomsShell: the shell locks body scroll and sits on top,
 * so that section was never visible or reachable.
 */
import { useEffect, useState } from "react";
import { BookOpen, CalendarClock, Disc3, Settings2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useKaraokeStage } from "@/lib/karaoke/stageStore";
import { KaraokeBookingPanel } from "@/components/karaoke/KaraokeBookingPanel";
import { KaraokeRecordingsPanel } from "@/components/karaoke/KaraokeRecordingsPanel";
import { KaraokeAdminPanel } from "@/components/karaoke/KaraokeAdminPanel";

export function KaraokeHub({
  roomId,
  roomName,
  bookingHostUserId,
}: {
  roomId: string;
  roomName: string;
  bookingHostUserId: string | null;
}) {
  const { user } = useAuth();
  const { settings } = useKaraokeStage();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("rules");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    void supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .then(({ data }) =>
        setIsAdmin(!!data?.some((r) => r.role === "admin" || r.role === "super_admin")),
      );
  }, [user?.id]);
  const isModerator = isAdmin || (!!user && bookingHostUserId === user.id);

  useEffect(() => {
    function onOpen(e: Event) {
      const t = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      if (t) setTab(t);
      setOpen(true);
    }
    window.addEventListener("karaoke:open-hub", onOpen as EventListener);
    return () => window.removeEventListener("karaoke:open-hub", onOpen as EventListener);
  }, []);

  const rules = settings.rules
    .split("\n")
    .map((r) => r.trim())
    .filter(Boolean);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 7.5rem)" }}
        className="fixed right-4 z-40 inline-flex items-center gap-1.5 rounded-full border border-gold/50 bg-background/85 px-3 py-1.5 text-[11px] font-semibold text-gold shadow-gold backdrop-blur hover:bg-gold/10"
      >
        <CalendarClock className="h-3.5 w-3.5" /> Room hub
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto border-gold/20 sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="font-display text-gradient-gold">{roomName}</SheetTitle>
          </SheetHeader>
          <Tabs value={tab} onValueChange={setTab} className="mt-4">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="rules" className="text-[11px]">
                <BookOpen className="mr-1 h-3 w-3" />
                Rules
              </TabsTrigger>
              <TabsTrigger value="book" className="text-[11px]">
                <CalendarClock className="mr-1 h-3 w-3" />
                Book
              </TabsTrigger>
              <TabsTrigger value="takes" className="text-[11px]">
                <Disc3 className="mr-1 h-3 w-3" />
                Takes
              </TabsTrigger>
              <TabsTrigger value="admin" className="text-[11px]" disabled={!isModerator}>
                <Settings2 className="mr-1 h-3 w-3" />
                Admin
              </TabsTrigger>
            </TabsList>

            <TabsContent value="rules" className="space-y-3 pt-3">
              {rules.length > 0 ? (
                <ol className="list-decimal space-y-1 pl-5 text-sm">
                  {rules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Be kind, cheer loud, one song per turn.
                </p>
              )}
              <ul className="space-y-1 rounded-lg border border-border/60 bg-black/30 p-3 text-xs text-muted-foreground">
                <li>
                  {settings.require_booking
                    ? "Booking-only room — reserve a slot to sing."
                    : "Open mic: join the line, or book a slot."}
                </li>
                {settings.max_song_seconds > 0 && (
                  <li>Songs are capped at {Math.round(settings.max_song_seconds / 60)} minutes.</li>
                )}
                {settings.holders_priority && (
                  <li>Verified BAYC/MAYC holders move to the front of the line.</li>
                )}
                {settings.recording_enabled && (
                  <li>Performances are recorded and replayable under Takes.</li>
                )}
                <li>Best sound: wear headphones and pick “Headphones” in the karaoke machine.</li>
              </ul>
            </TabsContent>
            <TabsContent value="book" className="pt-3">
              <KaraokeBookingPanel roomId={roomId} settings={settings} isModerator={isModerator} />
            </TabsContent>
            <TabsContent value="takes" className="pt-3">
              <KaraokeRecordingsPanel roomId={roomId} isAdmin={isAdmin} />
            </TabsContent>
            <TabsContent value="admin" className="pt-3">
              {isModerator ? (
                <KaraokeAdminPanel
                  roomId={roomId}
                  roomName={roomName}
                  settings={settings}
                  isAdmin={isAdmin}
                />
              ) : null}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </>
  );
}
