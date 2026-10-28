import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  getPublicPerformance,
  type PublicPerformance,
} from "@/server/public-performances.functions";
import { PublicPerformanceCard } from "@/components/karaoke/PublicPerformanceCard";

/** A single karaoke performance — public, no account needed (share links). */
export const Route = createFileRoute("/performance/$id")({
  head: () => ({ meta: [{ title: "Karaoke performance — BAYCmc" }] }),
  component: PerformancePage,
});

function PerformancePage() {
  const { id } = Route.useParams();
  const get = useServerFn(getPublicPerformance);
  const [p, setP] = useState<PublicPerformance | null | undefined>(undefined);
  useEffect(() => {
    void get({ data: { id } }).then((r) => setP(r.ok ? r.performance : null));
  }, [get, id]);
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <p className="mb-2 text-[11px] uppercase tracking-[0.3em] text-gold">BAYCmc karaoke</p>
      {p === undefined ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : p === null ? (
        <p className="text-sm text-muted-foreground">This performance isn't available.</p>
      ) : (
        <>
          <h1 className="mb-4 font-display text-2xl text-gradient-gold">
            {p.performerName} on the BAYCmc stage
          </h1>
          <PublicPerformanceCard p={p} />
          <Link
            to="/performer/$userId"
            params={{ userId: p.performerId }}
            className="mt-4 inline-block text-sm text-gold hover:underline"
          >
            More from {p.performerName} →
          </Link>
        </>
      )}
    </main>
  );
}
