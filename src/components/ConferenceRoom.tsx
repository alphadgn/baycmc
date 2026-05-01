import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getLivekitToken } from "@/server/livekit.functions";
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  ControlBar,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { toast } from "sonner";

interface ConferenceRoomProps {
  roomId: string;
  roomName: string;
}

export function ConferenceRoom({ roomId, roomName }: ConferenceRoomProps) {
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const getToken = useServerFn(getLivekitToken);

  async function join() {
    setConnecting(true);
    setError(null);
    try {
      const res = await getToken({ data: { roomId } });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        setConnecting(false);
        return;
      }
      setToken(res.token);
      setUrl(res.url);
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
  }, [roomId]);

  if (!token || !url) {
    return (
      <div className="glass rounded-2xl p-12 text-center shadow-card">
        <h2 className="font-display text-4xl text-gradient-gold">{roomName}</h2>
        <p className="mt-3 text-sm text-muted-foreground font-sans-display">
          Live audio + video conference room. Token Proof verified members only.
        </p>
        {error && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <button
          onClick={join}
          disabled={connecting}
          className="mt-6 rounded-md bg-gradient-gold px-6 py-3 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50 font-sans-display"
        >
          {connecting ? "Connecting…" : "Enter Room"}
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border" style={{ height: "75vh" }}>
      <LiveKitRoom
        token={token}
        serverUrl={url}
        connect={true}
        audio={true}
        video={true}
        data-lk-theme="default"
        onDisconnected={() => {
          setToken(null);
          setUrl(null);
        }}
        style={{ height: "100%" }}
      >
        <VideoConference />
        <RoomAudioRenderer />
        <ControlBar />
      </LiveKitRoom>
    </div>
  );
}
