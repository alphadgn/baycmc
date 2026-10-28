import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  listPublicPerformances,
  type PublicPerformance,
} from "@/server/public-performances.functions";
import { PublicPerformanceCard } from "@/components/karaoke/PublicPerformanceCard";

/** A performer's public page: their karaoke performances. No account needed. */
export const Route = createFileRoute("/performer/$userId")({
  head: () => ({ meta: [{ title: "Performer — BAYCmc karaoke" }] }),
  component: PerformerPage,
});

function PerformerPage() {
  const { userId } = Route.useParams();
  const list = useServerFn(listPublicPerformances);
  const [data, setData] = useState<{
    performer: { name: string; avatar: string | null } | null;
    performances: PublicPerformance[];
  } | null>(null);
  useEffect(() => {
    void list({ data: { performerId: userId } }).then(setData);
  }, [list, userId]);
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      {!data ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="mb-6 flex items-center gap-3">
            {data.performer?.avatar && (
              <img
                src={data.performer.avatar}
                alt=""
                className="h-14 w-14 rounded-full object-cover"
              />
            )}
            <div>
              <p className="text-[11px] uppercase tracking-[0.3em] text-gold">BAYCmc karaoke</p>
              <h1 className="font-display text-2xl text-gradient-gold">
                {data.performer?.name ?? "Performer"}
              </h1>
            </div>
          </div>
          {data.performances.length === 0 ? (
            <p className="text-sm text-muted-foreground">No public performances yet.</p>
          ) : (
            <div className="space-y-3">
              {data.performances.map((p) => (
                <PublicPerformanceCard key={p.id} p={p} showPerformer={false} />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
