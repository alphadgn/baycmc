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
import { Mic, MicOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface ProfileMini {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

interface AmaConferenceProps {
  roomName: string;
  hostUserId: string | null;
  backgroundImage: string | null;
}

const MAX_AUDIENCE_TILES = 25;

/**
 * Custom Discord-AMA layout — single host tile up top, adaptive audience grid
 * (2x2 → 5x5) underneath, overflow strip past 25. When any participant starts
 * a screen share the layout flips into a takeover view: shared screen fills
 * the main area, participants collapse into a vertical strip on the right.
 *
 * Host = the booking owner of the currently-active slot. Without a booking
 * (or before the booking owner joins) the host slot shows the room wallpaper.
 */
export function AmaConference({ roomName, hostUserId, backgroundImage }: AmaConferenceProps) {
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
}

function AmaGridLayout({
  roomName,
  hostParticipant,
  audienceParticipants,
  cameraTracks,
  profiles,
  backgroundImage,
  hasActiveBooking,
}: AmaGridLayoutProps) {
  const total = audienceParticipants.length;
  const visibleCount = Math.min(total, MAX_AUDIENCE_TILES);
  const overflowCount = total - visibleCount;
  const visible = audienceParticipants.slice(0, visibleCount);
  const overflow = audienceParticipants.slice(visibleCount);

  // Adaptive columns: 1 → 1, 2-4 → 2, 5-9 → 3, 10-16 → 4, 17-25 → 5.
  const cols =
    visibleCount <= 1
      ? 1
      : visibleCount <= 4
        ? 2
        : visibleCount <= 9
          ? 3
          : visibleCount <= 16
            ? 4
            : 5;

  // When there's no host present, drop the big host tile entirely so the
  // audience grid (where the user sees themselves) fills the visible area.
  // A compact "no host booked" indicator surfaces in the right rail instead
  // — handled by LiveRightRail in ConferenceRoom.tsx.
  const showHostTile = hostParticipant !== null;

  // With only a handful of people (and no host stage), a full-width grid
  // blows a single tile up to a giant square. Instead, cap each tile and
  // centre them so the video stays a sensible size on desktop and mobile.
  const sparse = !showHostTile && visibleCount > 0 && visibleCount <= 2;
  const sparseTileWidth = visibleCount === 1 ? "max-w-md" : "max-w-xs";

  return (
    <div
      className={`flex h-full flex-col gap-4 p-4 sm:p-6 ${
        sparse ? "min-h-[36vh]" : "min-h-[60vh]"
      }`}
    >
      {showHostTile && (
        <HostTile
          participant={hostParticipant}
          cameraTracks={cameraTracks}
          profiles={profiles}
          backgroundImage={backgroundImage}
          hasActiveBooking={hasActiveBooking}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {visibleCount === 0 ? (
          <EmptyAudience roomName={roomName} />
        ) : sparse ? (
          <div className="flex min-h-0 flex-1 flex-wrap items-center justify-center gap-3">
            {visible.map((p) => (
              <div key={p.identity} className={`w-full ${sparseTileWidth}`}>
                <AudienceTile
                  participant={p}
                  cameraTracks={cameraTracks}
                  profile={profiles.get(p.identity) ?? null}
                />
              </div>
            ))}
          </div>
        ) : (
          <div
            className="grid min-h-0 flex-1 gap-2 sm:gap-3"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
              gridAutoRows: "1fr",
            }}
          >
            {visible.map((p) => (
              <AudienceTile
                key={p.identity}
                participant={p}
                cameraTracks={cameraTracks}
                profile={profiles.get(p.identity) ?? null}
              />
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
}

function ScreenShareLayout({
  screenTrack,
  hostParticipant,
  audienceParticipants,
  cameraTracks,
  profiles,
  backgroundImage,
  hasActiveBooking,
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
        className="scrollbar-modern hidden w-56 shrink-0 flex-col gap-2 overflow-y-auto sm:flex"
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
          />
        )}
        {audienceParticipants.map((p) => (
          <AudienceTile
            key={p.identity}
            participant={p}
            cameraTracks={cameraTracks}
            profile={profiles.get(p.identity) ?? null}
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
}

function HostTile({
  participant,
  cameraTracks,
  profiles,
  backgroundImage,
  hasActiveBooking,
  compact = false,
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
      variant={compact ? "host-compact" : "host"}
    />
  );
}

interface AudienceTileProps {
  participant: Participant;
  cameraTracks: TrackReferenceOrPlaceholder[];
  profile: ProfileMini | null;
}

function AudienceTile({ participant, cameraTracks, profile }: AudienceTileProps) {
  return (
    <ParticipantVideoTile
      participant={participant}
      cameraTracks={cameraTracks}
      profile={profile}
      variant="audience"
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
}: {
  participant: Participant;
  cameraTracks: TrackReferenceOrPlaceholder[];
  profile: ProfileMini | null;
  variant: "host" | "host-compact" | "audience";
}) {
  const isSpeaking = useIsSpeaking(participant);
  const camTrack = cameraTracks.find((t) => t.participant.identity === participant.identity);
  const camOn =
    camTrack !== undefined && isTrackReference(camTrack) && !camTrack.publication.isMuted;
  const micOn = participant.isMicrophoneEnabled;

  const displayName =
    profile?.username || participant.name || `${participant.identity.slice(0, 6)}…`;

  const sizeClasses =
    variant === "host"
      ? "h-[42%] min-h-[200px] w-full"
      : variant === "host-compact"
        ? "aspect-square w-full"
        : "aspect-square w-full";

  const ringClasses = isSpeaking
    ? "border-gold shadow-[0_0_22px_-4px_rgba(212,175,55,0.7)]"
    : variant.startsWith("host")
      ? "border-gold/40"
      : "border-border/60";

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-2xl border-2 bg-card/40 ${sizeClasses} ${ringClasses}`}
    >
      {camOn && camTrack && isTrackReference(camTrack) ? (
        <VideoTrack trackRef={camTrack} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <NoCamPlaceholder profile={profile} displayName={displayName} large={variant === "host"} />
      )}

      {variant === "host" && (
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
  const sizeCls = large ? "h-24 w-24 text-3xl" : "h-14 w-14 text-base";

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-secondary/60 to-background/80">
      {profile?.avatar_url ? (
        <img
          src={profile.avatar_url}
          alt={displayName}
          className={`shrink-0 overflow-hidden rounded-full border-2 border-gold/40 object-cover ${sizeCls}`}
        />
      ) : (
        <ApeSilhouette className={sizeCls} initials={initialsFor(displayName)} />
      )}
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
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto rounded-xl border border-border/40 bg-background/40 px-3 py-2 backdrop-blur">
      <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted-foreground">
        Also in room
      </span>
      <ul className="flex shrink-0 items-center gap-2">
        {overflow.slice(0, 12).map((p) => {
          const prof = profiles.get(p.identity);
          const name = prof?.username || p.name || `${p.identity.slice(0, 6)}…`;
          return (
            <li key={p.identity} title={name} className="shrink-0">
              {prof?.avatar_url ? (
                <img
                  src={prof.avatar_url}
                  alt={name}
                  className="h-7 w-7 rounded-full border border-gold/40 object-cover"
                />
              ) : (
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-gold text-[10px] font-bold text-gold-foreground">
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
