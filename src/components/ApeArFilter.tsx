import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Face-tracked Ape AR preview.
 *
 * Opens the device camera, runs MediaPipe FaceLandmarker, and overlays the
 * user's verified BAYC PFP image scaled to lock on their face.
 *
 * V1 scope: local preview only. The processed canvas is shown back to the
 * user so they can verify the filter works. Publishing the processed
 * canvas as the LiveKit camera track requires sitting inside the
 * `<LiveKitRoom>` provider — wiring that in is a follow-up.
 */
export function ApeArFilter({ pfpUrl, onClose }: { pfpUrl: string; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pfpImgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let landmarker: any = null;
    let stream: MediaStream | null = null;

    async function start() {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = pfpUrl;
        pfpImgRef.current = img;

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 640, height: 480 },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
        );
        landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
        });

        if (cancelled) return;
        setStatus("ready");
        loop();
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : "Failed to start AR");
        setStatus("error");
      }
    }

    function loop() {
      if (cancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        rafRef.current = requestAnimationFrame(loop);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      // Mirror the camera so it feels like a mirror.
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(video, -w, 0, w, h);
      ctx.restore();

      if (landmarker && video.readyState >= 2) {
        try {
          const res = landmarker.detectForVideo(video, performance.now());
          const lm = res.faceLandmarks?.[0];
          if (lm && pfpImgRef.current?.complete) {
            let minX = 1,
              minY = 1,
              maxX = 0,
              maxY = 0;
            for (const p of lm) {
              if (p.x < minX) minX = p.x;
              if (p.y < minY) minY = p.y;
              if (p.x > maxX) maxX = p.x;
              if (p.y > maxY) maxY = p.y;
            }
            const mirX = 1 - maxX;
            const mirMaxX = 1 - minX;
            const boxW = (mirMaxX - mirX) * w;
            const boxH = (maxY - minY) * h;
            const pad = 0.35;
            const drawW = boxW * (1 + pad);
            const drawH = boxH * (1 + pad * 1.4);
            const cx = (mirX + (mirMaxX - mirX) / 2) * w;
            const cy = (minY + (maxY - minY) / 2) * h - boxH * 0.15;
            ctx.drawImage(pfpImgRef.current, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
          }
        } catch {
          /* swallow per-frame errors */
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    void start();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (landmarker?.close) landmarker.close();
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [pfpUrl]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4 backdrop-blur">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-gold/40 bg-black shadow-gold">
        <div className="flex items-center justify-between border-b border-gold/20 bg-gradient-to-b from-[#1a1a1a] to-[#0a0a0a] px-3 py-2">
          <span className="font-display text-xs uppercase tracking-[0.25em] text-gold">
            🦍 Ape AR · Preview
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Ape AR"
            className="rounded-md p-1 text-gold/70 hover:bg-gold/10 hover:text-gold"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="relative aspect-video w-full bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            className="absolute inset-0 h-full w-full opacity-0"
          />
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {status === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-gold/80">
              Loading camera and face tracker…
            </div>
          )}
          {status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-rose-300">
              <span className="font-semibold">Couldn't start Ape AR</span>
              <span className="text-rose-300/80">{errorMsg}</span>
            </div>
          )}
        </div>
        <div className="border-t border-gold/20 bg-[#0a0a0a] px-3 py-2 text-[10px] text-gold/60">
          Your verified BAYC is locked to your face. This is a local preview — publishing the AR
          feed into the live LiveKit stream is coming next.
        </div>
      </div>
    </div>
  );
}
