import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getKaraokeCatalogStats, seedKaraokeCatalog } from "@/lib/karaoke.functions";

export const Route = createFileRoute("/_authenticated/admin/karaoke")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const ok = roles?.some((r) => r.role === "admin" || r.role === "super_admin");
    if (!ok) throw redirect({ to: "/" });
  },
  head: () => ({ meta: [{ title: "Admin · Karaoke Catalog — BAYCMC" }] }),
  component: AdminKaraokePage,
});

interface Stats {
  totalSongs: number;
  lastSeededAt: string | null;
  lastInserted: number | null;
  lastSkipped: number | null;
  lastTotalCollected: number | null;
}

function AdminKaraokePage() {
  const seed = useServerFn(seedKaraokeCatalog);
  const fetchStats = useServerFn(getKaraokeCatalogStats);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const s = await fetchStats();
      setStats(s);
    } catch (e) {
      console.warn("loadStats", e);
    }
  }, [fetchStats]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  async function runSeed(label: string) {
    setBusy(true);
    try {
      const res = await seed();
      toast.success(`${label} complete`, {
        description: `Inserted ${res.inserted}, skipped ${res.skipped} duplicates (collected ${res.total}).`,
      });
      await loadStats();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Seed failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-gradient-gold sm:text-5xl">
            Admin · Karaoke Catalog
          </h1>
          <p className="mt-1 text-xs text-muted-foreground font-sans-display sm:text-sm">
            Populate the music machine with the top 1000 most-played karaoke songs.
          </p>
        </div>
        <Link
          to="/admin"
          className="inline-flex items-center gap-2 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold hover:bg-gold/20"
        >
          ← Audit
        </Link>
      </header>

      {/* Stats report */}
      <section className="glass mb-6 rounded-2xl p-6 shadow-card">
        <h2 className="font-display text-xl text-gold">Catalog report</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Total songs" value={stats ? stats.totalSongs.toLocaleString() : "…"} />
          <Stat
            label="Last inserted"
            value={stats?.lastInserted != null ? stats.lastInserted.toLocaleString() : "—"}
          />
          <Stat
            label="Last skipped"
            value={stats?.lastSkipped != null ? stats.lastSkipped.toLocaleString() : "—"}
          />
          <Stat
            label="Last seeded"
            value={stats?.lastSeededAt ? new Date(stats.lastSeededAt).toLocaleString() : "Never"}
          />
        </dl>
      </section>

      <section className="glass rounded-2xl p-6 shadow-card">
        <h2 className="font-display text-xl text-gold">Seed actions</h2>
        <p className="mt-2 text-sm text-muted-foreground font-sans-display">
          Scrapes KaraFun's Most Popular chart (pages 1–5) and upserts songs into the catalog. Safe
          to re-run — it refreshes existing ranks instead of duplicating rows. May take 30–90
          seconds.
        </p>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={() => runSeed("Seed")}
            disabled={busy}
            className="rounded-md bg-gradient-gold px-5 py-2 text-sm font-semibold text-gold-foreground shadow-gold font-sans-display disabled:opacity-50"
          >
            {busy ? "Working…" : "Seed catalog"}
          </button>
          <button
            onClick={() => runSeed("Reseed")}
            disabled={busy}
            className="rounded-md border border-gold/50 bg-gold/10 px-5 py-2 text-sm font-semibold text-gold font-sans-display hover:bg-gold/20 disabled:opacity-50"
          >
            {busy ? "Working…" : "Reseed now"}
          </button>
          <button
            onClick={loadStats}
            disabled={busy}
            className="rounded-md border border-border bg-secondary/40 px-4 py-2 text-sm font-sans-display hover:bg-secondary/60 disabled:opacity-50"
          >
            Refresh report
          </button>
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-black/30 p-3">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-display text-lg text-gold">{value}</dd>
    </div>
  );
}
