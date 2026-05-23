import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { seedKaraokeCatalog } from "@/lib/karaoke.functions";

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

function AdminKaraokePage() {
  const seed = useServerFn(seedKaraokeCatalog);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSeed() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await seed();
      setResult(`Seeded ${res.inserted} songs (collected ${res.total}).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Seed failed");
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

      <section className="glass rounded-2xl p-6 shadow-card">
        <h2 className="font-display text-xl text-gold">Seed catalog</h2>
        <p className="mt-2 text-sm text-muted-foreground font-sans-display">
          Scrapes KaraFun's Most Popular chart (pages 1–5) and upserts songs into
          the catalog. Safe to re-run — it refreshes existing ranks instead of
          duplicating rows. May take 30–90 seconds.
        </p>

        <button
          onClick={runSeed}
          disabled={busy}
          className="mt-4 rounded-md bg-gradient-gold px-5 py-2 text-sm font-semibold text-gold-foreground shadow-gold font-sans-display disabled:opacity-50"
        >
          {busy ? "Seeding…" : "Seed catalog now"}
        </button>

        {result && (
          <p className="mt-4 text-sm text-emerald-400 font-sans-display">{result}</p>
        )}
        {error && (
          <p className="mt-4 text-sm text-red-400 font-sans-display">Error: {error}</p>
        )}
      </section>
    </main>
  );
}
