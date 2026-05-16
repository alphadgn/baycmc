import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/_authenticated/lifers/")({
  head: () => ({
    meta: [{ title: "Lifers — BAYCMC" }],
  }),
  component: LifersHome,
});

function LifersHome() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="glass overflow-hidden rounded-2xl p-8 shadow-card sm:p-12">
        <div className="flex flex-col items-center text-center">
          <BrandLogo className="h-48 w-48 sm:h-64 sm:w-64" />
          <p className="mt-2 text-xs uppercase tracking-[0.4em] text-gold">
            Dual-verified · Lifers only
          </p>
          <h1 className="mt-4 font-display text-3xl font-bold sm:text-4xl">
            Welcome, Lifer.
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
            This wing of BAYCMC is invisible to anyone outside the Lifer circle.
            The conference room and the Lifer thread are yours.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            to="/lifers/room"
            className="glass rounded-2xl border border-gold/30 p-6 transition hover:border-gold"
          >
            <div className="font-display text-xs tracking-widest text-gold">01</div>
            <h2 className="mt-2 font-display text-xl font-semibold">Conference Room</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Private space for Lifer-only sessions.
            </p>
          </Link>
          <Link
            to="/lifers/messages"
            className="glass rounded-2xl border border-gold/30 p-6 transition hover:border-gold"
          >
            <div className="font-display text-xs tracking-widest text-gold">02</div>
            <h2 className="mt-2 font-display text-xl font-semibold">Lifer Chat</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Second messaging thread, mirroring the Commons but Lifers-only.
            </p>
          </Link>
        </div>
      </div>
    </main>
  );
}
