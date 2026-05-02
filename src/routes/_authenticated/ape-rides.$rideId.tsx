import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getApeRideToken } from "@/server/aperides.functions";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  GridLayout,
  ParticipantTile,
  useTracks,
  ControlBar,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import "@livekit/components-styles";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/ape-rides/$rideId")({
  component: ApeRideViewer,
});

function ApeRideViewer() {
  const { rideId } = Route.useParams();
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const getToken = useServerFn(getApeRideToken);

  async function join() {
    setConnecting(true);
    setError(null);
    try {
      const res = await getToken({ data: { rideId } });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setToken(res.token);
      setUrl(res.url);
      setIsHost(res.isHost);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to join";
      setError(msg);
      toast.error(msg);
    } finally {
      setConnecting(false);
    }
  }

  useEffect(() => {
    return () => {
      setToken(null);
      setUrl(null);
    };
  }, [rideId]);

  if (!token || !url) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Link to="/ape-rides" className="text-xs text-muted-foreground hover:text-foreground">
          ← All Ape Rides
        </Link>
        <div className="glass mt-4 rounded-2xl p-12 text-center shadow-card">
          <h1 className="font-display text-4xl text-gradient-gold">Ape Ride</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Join the live stream from inside the Wynwood clubhouse.
          </p>
          {error && (
            <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <button
            onClick={join}
            disabled={connecting}
            className="mt-6 rounded-md bg-gradient-gold px-6 py-3 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50"
          >
            {connecting ? "Connecting…" : "Join stream"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <Link to="/ape-rides" className="text-xs text-muted-foreground hover:text-foreground">
        ← All Ape Rides
      </Link>
      <div
        className="mt-3 overflow-hidden rounded-2xl border border-border"
        style={{ height: "75vh" }}
      >
        <LiveKitRoom
          token={token}
          serverUrl={url}
          connect={true}
          audio={isHost}
          video={isHost}
          data-lk-theme="default"
          onDisconnected={() => {
            setToken(null);
            setUrl(null);
          }}
          style={{ height: "100%" }}
        >
          <StreamView />
          <RoomAudioRenderer />
          {isHost && <ControlBar />}
        </LiveKitRoom>
      </div>
    </div>
  );
}

function StreamView() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: "calc(100% - 80px)" }}>
      <ParticipantTile />
    </GridLayout>
  );
}
