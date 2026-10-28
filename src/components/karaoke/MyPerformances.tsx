import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  listPublicPerformances,
  type PublicPerformance,
} from "@/server/public-performances.functions";
import { deleteKaraokeRecording } from "@/lib/karaoke/recordings.functions";
import { PublicPerformanceCard } from "@/components/karaoke/PublicPerformanceCard";

/** Profile → My performances: public karaoke takes, shareable, deletable any time. */
export function MyPerformances({ userId }: { userId: string }) {
  const list = useServerFn(listPublicPerformances);
  const del = useServerFn(deleteKaraokeRecording);
  const [rows, setRows] = useState<PublicPerformance[] | null>(null);
  const load = useCallback(async () => {
    const r = await list({ data: { performerId: userId } });
    setRows(r.performances);
  }, [list, userId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    if (
      !window.confirm(
        "Delete this performance? It will disappear from your public page and share links.",
      )
    )
      return;
    const res = await del({ data: { id } });
    if (!res.ok) toast.error(res.error);
    else {
      toast.success("Performance deleted.");
      void load();
    }
  }

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl font-bold">My performances</h2>
        <Link
          to="/performer/$userId"
          params={{ userId }}
          className="text-xs text-gold hover:underline"
        >
          View my public page
        </Link>
      </div>
      {rows === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Your karaoke performances will show here. They're public and shareable.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <PublicPerformanceCard
              key={p.id}
              p={p}
              showPerformer={false}
              actions={
                <button
                  type="button"
                  onClick={() => void remove(p.id)}
                  aria-label="Delete this performance"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-destructive/40 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
