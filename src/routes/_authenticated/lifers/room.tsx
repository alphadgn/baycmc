import { createFileRoute } from "@tanstack/react-router";
import { BrandLogo } from "@/components/BrandLogo";

export const Route = createFileRoute("/_authenticated/lifers/room")({
  head: () => ({
    meta: [{ title: "Lifer Conference Room — BAYCMC" }],
  }),
  component: LiferRoom,
});

function LiferRoom() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="glass rounded-2xl p-8 shadow-card sm:p-12">
        <div className="flex flex-col items-center text-center">
          <BrandLogo className="h-32 w-32 sm:h-40 sm:w-40" />
          <p className="mt-2 text-xs uppercase tracking-[0.4em] text-gold">Lifers conference</p>
          <h1 className="mt-3 font-display text-3xl font-bold">Conference Room</h1>
        </div>

        <div className="mt-10 grid place-items-center rounded-2xl border-2 border-dashed border-gold/30 bg-background/40 p-12 text-center">
          <div>
            <p className="font-display text-lg text-muted-foreground">
              Live audio & video session surface lands here.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              LiveKit integration arrives in the next phase.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
