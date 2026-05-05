import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth/useAuth";
import { EmbroideredImage } from "@/components/EmbroideredImage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BAYCMC — token-gated for verified BAYC holders" },
      { name: "description", content: "An exclusive social and real-time platform for verified Bored Ape Yacht Club holders. Verify your BAYC, then drop in." },
    ],
  }),
  component: Index,
});

function Index() {
  const { isAuthenticated } = useAuth();

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 opacity-60"
          style={{ background: "var(--gradient-radial-gold)" }}
        />
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:py-36">
          <div className="mx-auto max-w-3xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-3 py-1 text-xs font-medium text-gold uppercase tracking-wider">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-gold animate-pulse-glow" />
              Members only · BAYC/MAYC
            </div>
            <h1 className="mt-6 font-display text-5xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              <span className="block">The mobile clubhouse for</span>
              {/* Responsive clamp scales smoothly with viewport without overflow. */}
              {/* Sized so the visual gap above (to "clubhouse for") matches
                  the gap below (to the paragraph) — see reference IMG_2587. */}
              <EmbroideredImage
                variant="bored-apes"
                size="xl"
                alt="Bored Apes"
                clamp="clamp(6.5rem, 30vw, 15rem)"
                className="mx-auto -mt-2 w-full sm:-mt-3"
              />
            </h1>
            <p className="mt-2 text-lg leading-relaxed text-muted-foreground sm:mt-3 sm:text-xl">
              Yacht Club social network, live audio rooms, conference bookings, and local chapter
              sub communities — all behind a single signature from your wallet.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {isAuthenticated ? (
                <Link
                  to="/profile"
                  className="rounded-md bg-gradient-gold px-3 py-1.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
                >
                  Enter BAYCMC →
                </Link>
              ) : (
                <a
                  href="#verify"
                  className="rounded-md bg-gradient-gold px-3 py-1.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90"
                >
                  Verify Access
                </a>
              )}
              <a
                href="#features"
                className="rounded-md border border-border bg-secondary/30 px-3 py-1.5 text-sm font-medium hover:bg-secondary"
              >
                What's inside
              </a>
            </div>
          </div>

          {/* Trust strip */}
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-2 gap-4 text-center">
            {[
              { k: "10,000", v: "BAYC supply" },
              { k: "24/7", v: "Live rooms" },
            ].map((s) => (
              <div key={s.v} className="glass rounded-xl px-4 py-5">
                <div className="font-display text-2xl font-bold text-gradient-gold sm:text-3xl">{s.k}</div>
                <div className="mt-1 text-xs text-muted-foreground uppercase tracking-wide">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Verify steps */}
      <section id="verify" className="border-t border-border/50">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">How access works</h2>
            <p className="mt-3 text-muted-foreground">Three simple steps</p>
          </div>
          <div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-3">
            {[
              { n: "01", t: "Open Verification", d: "Tap Entrance to launch the verification." },
              { n: "02", t: "Verify and Approve", d: "Verify with your Tokenproof app and approve the request to gain access inside the mobile clubhouse." },
              { n: "03", t: "You're In", d: "Confirm ownership through Tokenproof, Privy or Wallet delegation of your BAYC/MAYC and have instant access." },
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
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">What's inside</h2>
            <p className="mt-3 text-muted-foreground">A growing platform built feature-by-feature.</p>
          </div>
          <div className="mx-auto mt-12 grid max-w-6xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { t: "Social Feed", d: "Posts, likes, comments, follows. Realtime.", soon: true },
              { t: "Audio Rooms", d: "Drop-in voice. Hosts and listeners.", soon: true },
              { t: "Video Calls", d: "1:1 and group, powered by LiveKit.", soon: true },
              { t: "Conference Bookings", d: "20 rooms. Calendar with conflict-free slots.", soon: true },
              { t: "Club Chapters", d: "Apply, lead, host events for your local chapter.", soon: true },
              
            ].map((f) => (
              <div key={f.t} className="glass rounded-2xl p-6 shadow-card transition hover:border-gold/40">
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
          <p>© BAYCMC. Independent and unaffiliated with Yuga Labs.</p>
          <p className="font-mono text-xs">v0.1 · foundation</p>
        </div>
      </footer>
    </main>
  );
}
