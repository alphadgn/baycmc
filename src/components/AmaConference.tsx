import { useEffect, useMemo, useRef, useState } from "react";
import {
  isTrackReference,
  useIsSpeaking,
  useParticipants,
  useTracks,
  VideoTrack,
  type TrackReferenceOrPlaceholder,
} from "@livekit/components-react";
import { Track, type Participant } from "livekit-client";
import { Crown, Mic, MicOff } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { fetchVipUserIds } from "@/lib/karaoke/vip.functions";

interface ProfileMini {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

interface AmaConferenceProps {
  roomName: string;
  hostUserId: string | null;
  backgroundImage: string | null;
  /**
   * Karaoke rooms shrink the host pfp tile to half its conference size and
   * render audience tiles at the same reduced footprint, so the stage stays
   * focused on the music machine rather than the camera grid.
   */
  karaoke?: boolean;
}

// Audience grid is a fixed 4 across × 5 down = 20 tiles; everyone past that
// folds into the "Also in room" overflow strip.
const AUDIENCE_COLS = 4;
const AUDIENCE_ROWS = 5;
const MAX_AUDIENCE_TILES = AUDIENCE_COLS * AUDIENCE_ROWS;

/**
 * Custom Discord-AMA layout — single host tile affixed to the top, a fixed
 * 4-across × 5-down audience grid underneath, overflow strip past 20. When
 * any participant starts a screen share the layout flips into a takeover
 * view: shared screen fills the main area, participants collapse into a
 * vertical strip on the right.
 *
 * Host = the booking owner of the currently-active slot. Without a booking
 * (or before the booking owner joins) the host slot shows the room wallpaper.
 */
export function AmaConference({ roomName, hostUserId, backgroundImage, karaoke = false }: AmaConferenceProps) {
  const participants = useParticipants();

  // Two queries: every participant's camera track (with placeholders so we
  // can still render a tile when their cam is off) and any active screen
  // share. The screen-share list drives the layout flip.
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }]);
  const screenShareTracks = useTracks([
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);

  const profiles = useParticipantProfiles(participants);

  const hostParticipant = useMemo(
    () => (hostUserId ? (participants.find((p) => p.identity === hostUserId) ?? null) : null),
    [participants, hostUserId],
  );

  const audienceParticipants = useMemo(() => {
    if (!hostParticipant) return participants;
    return participants.filter((p) => p.identity !== hostParticipant.identity);
  }, [participants, hostParticipant]);

  // In karaoke rooms, resolve which participants are verified BAYC/MAYC
  // holders so we can crown their tiles. Non-karaoke rooms skip the call.
  const vipUserIds = useVipUserIds(participants, karaoke);

  const activeScreenShare = screenShareTracks.find(isTrackReference) ?? null;

  if (activeScreenShare) {
    return (
      <ScreenShareLayout
        screenTrack={activeScreenShare}
        hostParticipant={hostParticipant}
        audienceParticipants={audienceParticipants}
        cameraTracks={cameraTracks}
        profiles={profiles}
        backgroundImage={backgroundImage}
        hasActiveBooking={hostUserId !== null}
        vipUserIds={vipUserIds}
      />
    );
  }

  return (
    <AmaGridLayout
      roomName={roomName}
      hostParticipant={hostParticipant}
      audienceParticipants={audienceParticipants}
      cameraTracks={cameraTracks}
      profiles={profiles}
      backgroundImage={backgroundImage}
      hasActiveBooking={hostUserId !== null}
      karaoke={karaoke}
      vipUserIds={vipUserIds}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Grid layout (default)
// ────────────────────────────────────────────────────────────────────────────

interface AmaGridLayoutProps {
  roomName: string;
  hostParticipant: Participant | null;
  audienceParticipants: Participant[];
  cameraTracks: TrackReferenceOrPlaceholder[];
  profiles: Map<string, ProfileMini>;
  backgroundImage: string | null;
  hasActiveBooking: boolean;
  karaoke?: boolean;
  vipUserIds: Set<string>;
}

function AmaGridLayout({
  roomName,
  hostParticipant,
  audienceParticipants,
  cameraTracks,
  profiles,
  backgroundImage,
  hasActiveBooking,
  karaoke = false,
  vipUserIds,
}: AmaGridLayoutProps) {
  const total = audienceParticipants.length;
  const visibleCount = Math.min(total, MAX_AUDIENCE_TILES);
  const overflowCount = total - visibleCount;
  const visible = audienceParticipants.slice(0, visibleCount);
  const overflow = audienceParticipants.slice(visibleCount);

  // The host tile is rendered when a host participant is present. A compact
  // "no host booked" indicator surfaces in the right rail otherwise —
  // handled by LiveRightRail in ConferenceRoom.tsx.
  const showHostTile = hostParticipant !== null;
  // Host is alone (no audience) → blow the host card up to a Discord-style
  // self-view so the user can actually see themselves on mobile. In karaoke
  // rooms we keep the host card at its halved footprint even when solo so
  // there's always room for the music machine on top of the stage.
  const hostSolo = showHostTile && visibleCount === 0 && !karaoke;

  // Adaptive responsive columns. The original spec is 4 across × 5 down as
  // the room fills up, but with only a handful of people we drop to 2–3
  // columns (and one big centered card when there's a single tile) so a
  // lone attendee doesn't get rendered at thumbnail size on mobile. Tops
  // out at the 4-col / 20-tile cap from MAX_AUDIENCE_TILES.
  const gridColsClass =
    visibleCount <= 4
      ? "grid-cols-2"
      : visibleCount <= 9
        ? "grid-cols-2 sm:grid-cols-3"
        : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4";

  // All rooms (conference + karaoke): cap host pfp tile and every audience
  // tile to a fixed 80px (w-20) footprint so video thumbnails never balloon
  // beyond the avatar size shown in the reference screenshot.
  const hostWrapperClass = "mx-auto w-20";


  return (
    <div className="flex min-h-[60vh] flex-col gap-4 p-4 sm:p-6">
      {/* Host stays affixed to the top of the room while the audience grid
          scrolls beneath it (the RoomsShell <main> is the scroll container).
          The translucent strip keeps audience tiles from peeking through the
          gap as they slide under. */}
      {showHostTile && (
        <div className="sticky top-0 z-10 -mx-4 bg-background/80 px-4 pb-3 pt-1 backdrop-blur sm:-mx-6 sm:px-6">
          {/* Solo host (alone in the room) keeps the big self-view. With an
              audience present the host card is halved — centered at 50%
              width — so it stays the focal point without dominating the
              attendee thumbnails below it. */}
          <div className={hostWrapperClass}>
            <HostTile
              participant={hostParticipant}
              cameraTracks={cameraTracks}
              profiles={profiles}
              backgroundImage={backgroundImage}
              hasActiveBooking={hasActiveBooking}
              solo={hostSolo}
              vipUserIds={vipUserIds}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visibleCount === 0 ? (
          // Hide the "no one else here yet" copy when the host is alone —
          // their big solo card already speaks for itself.
          hostSolo ? null : <EmptyAudience roomName={roomName} />
        ) : (
          // Every room (conference + karaoke): render attendees at a fixed
          // 80px (w-20) footprint, wrapping naturally on mobile, so no
          // square/rectangle pfp ever exceeds the reference avatar size.
          <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
            {visible.map((p) => (
              <div key={p.identity} className="w-20 min-w-0">
                <AudienceTile
                  participant={p}
                  cameraTracks={cameraTracks}
                  profile={profiles.get(p.identity) ?? null}
                  isVip={vipUserIds.has(p.identity)}
                />
              </div>
            ))}
          </div>
        )}
        {overflowCount > 0 && (
          <OverflowStrip overflow={overflow} profiles={profiles} count={overflowCount} />
        )}
      </div>

    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Screen-share takeover layout
// ────────────────────────────────────────────────────────────────────────────

interface ScreenShareLayoutProps {
  screenTrack: TrackReferenceOrPlaceholder;
  hostParticipant: Participant | null;
  audienceParticipants: Participant[];
  cameraTracks: TrackReferenceOrPlaceholder[];
  profiles: Map<string, ProfileMini>;
  backgroundImage: string | null;
  hasActiveBooking: boolean;
  vipUserIds: Set<string>;
}

function ScreenShareLayout({
  screenTrack,
  hostParticipant,
  audienceParticipants,
  cameraTracks,
  profiles,
  backgroundImage,
  hasActiveBooking,
  vipUserIds,
}: ScreenShareLayoutProps) {
  const sharerName =
    profiles.get(screenTrack.participant.identity)?.username ||
    screenTrack.participant.name ||
    screenTrack.participant.identity.slice(0, 6);

  return (
    <div className="flex h-full min-h-[60vh] gap-3 p-3 sm:p-4">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-gold/30 bg-black">
        {isTrackReference(screenTrack) ? (
          <VideoTrack
            trackRef={screenTrack}
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : null}
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-gold/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-gold backdrop-blur">
          {sharerName} is sharing
        </div>
      </div>

      <aside
        className="scrollbar-modern hidden w-56 shrink-0 flex-col gap-2 overflow-x-hidden overflow-y-auto sm:flex"
        aria-label="Participants strip"
      >
        {hostParticipant && (
          <HostTile
            participant={hostParticipant}
            cameraTracks={cameraTracks}
            profiles={profiles}
            backgroundImage={backgroundImage}
            hasActiveBooking={hasActiveBooking}
            compact
            vipUserIds={vipUserIds}
          />
        )}
        {audienceParticipants.map((p) => (
          <AudienceTile
            key={p.identity}
            participant={p}
            cameraTracks={cameraTracks}
            profile={profiles.get(p.identity) ?? null}
            isVip={vipUserIds.has(p.identity)}
          />
        ))}
      </aside>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tiles
// ────────────────────────────────────────────────────────────────────────────

interface HostTileProps {
  participant: Participant | null;
  cameraTracks: TrackReferenceOrPlaceholder[];
  profiles: Map<string, ProfileMini>;
  backgroundImage: string | null;
  hasActiveBooking: boolean;
  compact?: boolean;
  /** True when the host is the only participant — get a bigger Discord-style card. */
  solo?: boolean;
  vipUserIds?: Set<string>;
}

function HostTile({
  participant,
  cameraTracks,
  profiles,
  backgroundImage,
  hasActiveBooking,
  compact = false,
  solo = false,
  vipUserIds,
}: HostTileProps) {
  // No host present → wallpaper fallback with status copy.
  if (!participant) {
    const wallStyle = backgroundImage
      ? {
          backgroundImage: `linear-gradient(rgba(8,8,12,0.55), rgba(8,8,12,0.85)), url(${backgroundImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : {};
    return (
      <div
        className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gold/30 ${
          compact ? "aspect-square w-full" : "h-[42%] min-h-[200px]"
        }`}
        style={wallStyle}
      >
        <div className="text-center">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {hasActiveBooking ? "Waiting for host…" : "Open session"}
          </p>
          {!compact && (
            <h3 className="mt-1 font-display text-2xl text-gradient-gold sm:text-3xl">
              {hasActiveBooking ? "Host will join shortly" : "No host booked"}
            </h3>
          )}
        </div>
      </div>
    );
  }

  return (
    <ParticipantVideoTile
      participant={participant}
      cameraTracks={cameraTracks}
      profile={profiles.get(participant.identity) ?? null}
      variant={compact ? "host-compact" : solo ? "host-solo" : "host"}
      isVip={vipUserIds?.has(participant.identity) ?? false}
    />
  );
}

interface AudienceTileProps {
  participant: Participant;
  cameraTracks: TrackReferenceOrPlaceholder[];
  profile: ProfileMini | null;
  isVip?: boolean;
}

function AudienceTile({ participant, cameraTracks, profile, isVip = false }: AudienceTileProps) {
  return (
    <ParticipantVideoTile
      participant={participant}
      cameraTracks={cameraTracks}
      profile={profile}
      variant="audience"
      isVip={isVip}
    />
  );
}

/**
 * Shared tile primitive used by both the host slot and audience grid.
 * Renders the participant's video when their camera is publishing; otherwise
 * shows their PFP (or BAYC-themed initials fallback). Overlays: speaking ring,
 * name pill, mic-state indicator.
 */
function ParticipantVideoTile({
  participant,
  cameraTracks,
  profile,
  variant,
  isVip = false,
}: {
  participant: Participant;
  cameraTracks: TrackReferenceOrPlaceholder[];
  profile: ProfileMini | null;
  variant: "host" | "host-compact" | "host-solo" | "audience" | "solo";
  isVip?: boolean;
}) {
  const isSpeaking = useIsSpeaking(participant);
  const camTrack = cameraTracks.find((t) => t.participant.identity === participant.identity);
  const camOn =
    camTrack !== undefined && isTrackReference(camTrack) && !camTrack.publication.isMuted;
  const micOn = participant.isMicrophoneEnabled;

  const displayName =
    profile?.username || participant.name || `${participant.identity.slice(0, 6)}…`;

  // "solo" / "host-solo" → Discord-style self-view when only one tile is on
  // screen: tall on mobile (aspect 3:4), banner on desktop (16:9). Plain
  // "host" stays 16:9 so the host strip never dominates when an audience
  // grid renders below it. "audience" / "host-compact" keep the square
  // thumbnail used by the dense grid.
  const sizeClasses =
    variant === "host"
      ? "aspect-video w-full"
      : variant === "host-solo"
        ? "aspect-[3/4] w-full sm:aspect-video"
        : variant === "host-compact"
          ? "aspect-square w-full"
          : variant === "solo"
            ? "aspect-[3/4] w-full sm:aspect-video"
            : "aspect-square w-full";

  const ringClasses = isSpeaking
    ? "border-gold shadow-[0_0_22px_-4px_rgba(212,175,55,0.7)]"
    : variant.startsWith("host")
      ? "border-gold/40"
      : "border-border/60";

  const isHostVariant = variant === "host" || variant === "host-solo";
  const isLargeNoCam = isHostVariant || variant === "solo";

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-2xl border-2 bg-card/40 ${sizeClasses} ${ringClasses}`}
    >
      {camOn && camTrack && isTrackReference(camTrack) ? (
        <VideoTrack trackRef={camTrack} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <NoCamPlaceholder profile={profile} displayName={displayName} large={isLargeNoCam} />
      )}

      {isHostVariant && (
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-gold/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-gold backdrop-blur">
          Host
        </div>
      )}

      <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2">
        <span className="max-w-[70%] truncate rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-foreground backdrop-blur sm:text-[11px]">
          {displayName}
        </span>
        <span
          aria-label={micOn ? "Microphone on" : "Microphone muted"}
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full backdrop-blur ${
            micOn ? "bg-emerald-500/20 text-emerald-300" : "bg-destructive/20 text-destructive"
          }`}
        >
          {micOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3" />}
        </span>
      </div>
    </div>
  );
}

function NoCamPlaceholder({
  profile,
  displayName,
  large,
}: {
  profile: ProfileMini | null;
  displayName: string;
  large: boolean;
}) {
  // Camera off → the member's pfp fills the whole tile container (cover),
  // not a small centred circle, so the placeholder reads as "them". A light
  // bottom gradient keeps the name pill and mic badge legible over it.
  if (profile?.avatar_url) {
    return (
      <div className="absolute inset-0">
        <img
          src={profile.avatar_url}
          alt={displayName}
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-background/60 via-transparent to-transparent" />
      </div>
    );
  }

  // No pfp on file → on-brand gold initials chip.
  const sizeCls = large ? "h-24 w-24 text-3xl" : "h-14 w-14 text-base";
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-secondary/60 to-background/80">
      <ApeSilhouette className={sizeCls} initials={initialsFor(displayName)} />
    </div>
  );
}

function ApeSilhouette({ className, initials }: { className: string; initials: string }) {
  // Stylized BAYC-themed placeholder: gold gradient circle with the user's
  // initials. Cheap, on-brand, and avoids shipping an SVG asset we don't have.
  return (
    <div
      className={`inline-flex items-center justify-center rounded-full bg-gradient-gold font-display font-bold text-gold-foreground shadow-gold ${className}`}
      aria-hidden
    >
      {initials}
    </div>
  );
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/[\s_-]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

// ────────────────────────────────────────────────────────────────────────────
// Overflow strip + empty state
// ────────────────────────────────────────────────────────────────────────────

function OverflowStrip({
  overflow,
  profiles,
  count,
}: {
  overflow: Participant[];
  profiles: Map<string, ProfileMini>;
  count: number;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-xl border border-border/40 bg-background/40 px-3 py-2 backdrop-blur">
      <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
        Also in room
      </span>
      <ul className="flex flex-wrap items-center gap-2">
        {overflow.slice(0, 12).map((p) => {
          const prof = profiles.get(p.identity);
          const name = prof?.username || p.name || `${p.identity.slice(0, 6)}…`;
          return (
            <li key={p.identity} title={name} className="shrink-0">
              {prof?.avatar_url ? (
                <img
                  src={prof.avatar_url}
                  alt={name}
                  className="h-20 w-20 rounded-full border border-gold/40 object-cover"
                />
              ) : (
                <span className="inline-flex h-20 w-20 items-center justify-center rounded-full bg-gradient-gold text-sm font-bold text-gold-foreground">
                  {initialsFor(name)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {count > 12 && (
        <span className="shrink-0 text-[10px] font-semibold text-gold">+{count - 12} more</span>
      )}
    </div>
  );
}

function EmptyAudience({ roomName }: { roomName: string }) {
  return (
    <div className="flex h-full min-h-[160px] flex-1 items-center justify-center rounded-2xl border border-dashed border-border/40 bg-background/30 px-4 text-center">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{roomName}</p>
        <h4 className="mt-1 font-display text-lg text-foreground sm:text-xl">
          No one else here yet
        </h4>
        <p className="mt-1 text-[11px] text-muted-foreground sm:text-xs">
          Share the room link to invite verified members.
        </p>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Profile lookup
// ────────────────────────────────────────────────────────────────────────────

/**
 * Batches a profile fetch for every newly-seen participant. We track fetched
 * IDs in a ref so participant churn (re-render of the participants array)
 * doesn't trigger duplicate requests.
 */
function useParticipantProfiles(participants: Participant[]): Map<string, ProfileMini> {
  const [profiles, setProfiles] = useState<Map<string, ProfileMini>>(() => new Map());
  const fetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const toFetch = participants
      .map((p) => p.identity)
      .filter((id) => id && !fetchedRef.current.has(id));
    if (toFetch.length === 0) return;
    for (const id of toFetch) fetchedRef.current.add(id);

    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,username,avatar_url")
        .in("id", toFetch);
      if (cancelled || !data) return;
      setProfiles((prev) => {
        const next = new Map(prev);
        for (const row of data) {
          next.set(row.id as string, {
            id: row.id as string,
            username: (row.username as string | null) ?? null,
            avatar_url: (row.avatar_url as string | null) ?? null,
          });
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [participants]);

  return profiles;
}
