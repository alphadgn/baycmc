import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getLivekitToken, revalidateLivekitRoomAccess } from "@/server/livekit.functions";
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
  const [accessLossMessage, setAccessLossMessage] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const getToken = useServerFn(getLivekitToken);
  const revalidateAccess = useServerFn(revalidateLivekitRoomAccess);

  function showAccessLoss(message: string) {
    setAccessLossMessage(message);
    setError(message);
    setToken(null);
    setUrl(null);
    toast.error("Exclusive room locked", { description: message, duration: 8000 });
  }

  async function join() {
    setConnecting(true);
    setError(null);
    try {
      const res = await getToken({ data: { roomId } });
      if (!res.ok) {
        setError(res.error);
        if (res.code === "bayc_revoked" || res.code === "otherpage_revoked") {
          setAccessLossMessage(res.error);
        }
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

  useEffect(() => {
    if (!token || !url) return;
    let cancelled = false;
    async function checkAccess() {
      const res = await revalidateAccess({ data: { roomId } }).catch((e) => {
        console.error("Room access revalidation failed", e);
        return null;
      });
      if (cancelled || !res || res.ok) return;
      showAccessLoss(res.error);
    }
    const interval = window.setInterval(checkAccess, 30_000);
    window.addEventListener("focus", checkAccess);
    document.addEventListener("visibilitychange", checkAccess);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", checkAccess);
      document.removeEventListener("visibilitychange", checkAccess);
    };
  }, [roomId, token, url, revalidateAccess]);

  if (!token || !url) {
    return (
      <div className="glass rounded-2xl p-12 text-center shadow-card">
        {accessLossMessage && (
          <div
            role="alertdialog"
            aria-labelledby="access-loss-title"
            className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-left"
          >
            <h3 id="access-loss-title" className="text-sm font-semibold text-destructive">
              Exclusive access changed
            </h3>
            <p className="mt-2 text-sm text-foreground">{accessLossMessage}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Refresh your wallet delegation or reconnect with a wallet that currently qualifies, then try again.
            </p>
          </div>
        )}
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
