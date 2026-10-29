import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getBaycSupply } from "@/server/collection-stats.functions";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { EmbroideredImage } from "@/components/EmbroideredImage";

const OPENSEA_BAYC = "https://opensea.io/collection/boredapeyachtclub";

const HERO_TAGLINE =
  "Yacht Club social network, karaoke w/tipping, Mudwater gameplay PvP & PvAi, free conference room bookings, local chapter community rooms, club event live streams and so much more!";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BAYCmc — the BAYC/MAYC mobile clubhouse" },
      { property: "og:title", content: "BAYCmc — the BAYC/MAYC mobile clubhouse" },
      {
        property: "og:description",
        content:
          "The BAYCmc wallet-connected clubhouse for live rooms, member conversations and on-chain holder verification.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        name: "description",
        content:
          "Sign in with any wallet or email to enter the lobby. Verify your BAYC or MAYC to unlock conference rooms, the social feed, and live events.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { isAuthenticated, loading } = useAuth();
  const { isVerifiedHolder, loading: verifLoading } = useVerificationStatus();
  const navigate = useNavigate();

  // After sign-in: verified holders go straight to the social feed,
  // everyone else lands in the lobby (Tier 1).
  useEffect(() => {
    if (loading || verifLoading) return;
    if (!isAuthenticated) return;
    void navigate({ to: isVerifiedHolder ? "/feed" : "/lobby", replace: true });
  }, [isAuthenticated, isVerifiedHolder, loading, verifLoading, navigate]);

  return (
    <main className="max-w-full overflow-x-hidden">
      {/* Hero */}
      <section className="relative max-w-full overflow-x-hidden overflow-y-visible">
        <div
          className="absolute inset-0 -z-10 opacity-60"
          style={{ background: "var(--gradient-radial-gold)" }}
        />
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-28 lg:py-36">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="mt-5 font-display text-4xl font-bold leading-[1.05] tracking-tight sm:mt-6 sm:text-6xl lg:text-7xl">
              <span className="block">The mobile clubhouse for</span>
              {/* Responsive clamp scales smoothly with viewport without overflow. */}
              {/* Sized so the visual gap above (to "clubhouse for") matches
                  the gap below (to the paragraph) — see reference IMG_2587. */}
              <EmbroideredImage
                variant="bored-apes"
                size="xl"
                alt="Bored Apes"
                clamp="clamp(6.5rem, 30vw, 15rem)"
                className="mx-auto -mt-2 w-full max-w-[calc(100vw-2rem)] sm:-mt-3"
              />
            </h1>
            <p
              className="hero-tagline mt-2 text-sm leading-relaxed text-white sm:mt-3 sm:text-xl"
              aria-label={HERO_TAGLINE}
            >
              {HERO_TAGLINE.split(" ").map((w, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className="hero-tagline-word"
                  style={{ animationDelay: `${0.25 + i * 0.06}s` }}
                >
                  {w}{" "}
                </span>
              ))}
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {isAuthenticated ? (
                <Link
                  to="/profile"
                  className="rounded-md bg-gradient-gold px-3 py-1.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
                >
                  Enter BAYCmc →
                </Link>
              ) : (
                <Link
                  to="/login"
                  className="rounded-md bg-gradient-gold px-3 py-1.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
                >
                  Main Entrance
                </Link>
              )}
              <Link
                to="/verify"
                className="rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-sm font-medium hover:bg-secondary"
              >
                How verification works
              </Link>
            </div>
          </div>

          {/* Trust strip */}
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-2 gap-4 text-center">
            <a
              href={OPENSEA_BAYC}
              target="_blank"
              rel="noopener noreferrer"
              title="Live from OpenSea"
              className="glass block rounded-xl px-4 py-5 transition hover:border-gold/50"
            >
              <div className="font-display text-2xl font-bold text-gradient-gold sm:text-3xl">
                <BaycSupply />
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                Collection size
              </div>
            </a>
            <div className="glass rounded-xl px-4 py-5">
              <div className="font-display text-2xl font-bold text-gradient-gold sm:text-3xl">
                24/7
              </div>
              <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                Live rooms
              </div>
            </div>
          </div>
          {/* Same destination as the Collection size tile. */}
          <div className="mt-5 text-center">
            <a
              href={OPENSEA_BAYC}
              target="_blank"
              rel="noopener noreferrer"
              className="buy-ape-cta text-sm font-semibold uppercase tracking-[0.18em] text-gold"
            >
              Buy a Bored Ape
            </a>
          </div>
        </div>
      </section>

      {/* Verify steps */}
      <section id="verify" className="border-t border-border/50">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">How access works</h2>
            <p className="mt-3 text-muted-foreground">Three simple steps</p>
          </div>
          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-3">
            {[
              {
                n: "01",
                t: "Sign in",
                d: "Connect your wallet through Glyph — or use email if you're not a holder. You're inside the lobby instantly, no extra app.",
              },
              {
                n: "02",
                t: "Verify your ape",
                d: "Verify a BAYC or MAYC in your wallet (or a vault delegated to you on delegate.cash) to unlock the feed, conference rooms, messages, and Ape Rides.",
              },
              {
                n: "03",
                t: "Unlock the clubhouse lore",
                d: "Unlock the clubhouse lore once you're inside.",
              },
            ].map((s) => (
              <div key={s.n} className="glass rounded-2xl p-6 shadow-card">
                <div className="font-display text-xs text-gold tracking-widest">{s.n}</div>
                <h3 className="mt-3 font-display text-xl font-semibold">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border/50 bg-card/20">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">What's inside</h2>
            <p className="mt-3 text-muted-foreground">
              A growing platform built feature-by-feature.
            </p>
          </div>
          <div className="mx-auto mt-12 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { t: "Social Feed", d: "Posts, likes, comments, follows. Realtime.", soon: true },
              { t: "Audio Rooms", d: "Drop-in voice. Hosts and listeners.", soon: true },
              { t: "Video Calls", d: "1:1 and group, powered by LiveKit.", soon: true },
              {
                t: "Conference Bookings",
                d: "20 rooms. Calendar with conflict-free slots.",
                soon: true,
              },
              {
                t: "Club Chapters",
                d: "Apply, lead, host events for your local chapter.",
                soon: true,
              },
            ].map((f) => (
              <div
                key={f.t}
                className="glass rounded-2xl p-6 shadow-card transition hover:border-gold/40"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-semibold">{f.t}</h3>
                  {f.soon && (
                    <span className="rounded-full border border-gold/30 bg-gold/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gold">
                      Soon
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border/50">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <p>© BAYCmc 2026. Not affiliated with Yuga Labs.</p>
          <p className="font-mono text-xs">v0.1 · Devs0ng0, LLC @devs0ng0</p>
        </div>
      </footer>
    </main>
  );
}

/**
 * Live BAYC collection size from OpenSea (falls back to the contract's
 * on-chain totalSupply). Refreshes every 5 minutes while the page is open.
 */
function BaycSupply() {
  const fetchSupply = useServerFn(getBaycSupply);
  const [supply, setSupply] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchSupply()
        .then((r) => {
          if (!cancelled && r.supply) setSupply(r.supply);
        })
        .catch(() => {});
    void load();
    const t = window.setInterval(load, 5 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [fetchSupply]);
  return (
    <span className="text-gradient-gold">
      {supply === null ? "…" : supply.toLocaleString("en-US")}
    </span>
  );
}
