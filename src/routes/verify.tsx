import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck, Wallet, KeyRound, DoorOpen, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";
import { LinkedWalletsPanel } from "@/components/LinkedWalletsPanel";
import { VerificationStatusPanel } from "@/components/VerificationStatusPanel";

export const Route = createFileRoute("/verify")({
  head: () => ({
    meta: [
      { title: "Verify BAYC / MAYC ownership — BAYCMC" },
      {
        name: "description",
        content:
          "End-to-end walkthrough for verifying Bored Ape or Mutant Ape ownership and linking additional wallets to unlock the BAYCMC clubhouse.",
      },
      { property: "og:title", content: "Verify BAYC / MAYC ownership — BAYCMC" },
      {
        property: "og:description",
        content:
          "Step-by-step VIP onboarding: connect, sign, and verify your ape — including delegate.cash vaults and additional linked wallets.",
      },
    ],
  }),
  component: VerifyPage,
});

interface Step {
  n: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: React.ReactNode;
}

const STEPS: Step[] = [
  {
    n: "01",
    icon: Wallet,
    title: "Sign in with your wallet",
    body: (
      <>
        From the BAYCMC home page tap <span className="font-semibold">VIP</span> and connect with
        Glyph. Glyph supports any EVM wallet — MetaMask, Rainbow, Coinbase Wallet, Ledger via
        WalletConnect — and embedded email wallets. Your signing wallet address is stored on your
        profile and used as the primary check.
      </>
    ),
  },
  {
    n: "02",
    icon: KeyRound,
    title: "Sign the ownership challenge",
    body: (
      <>
        Right after sign-in BAYCMC checks your wallet for{" "}
        <a
          href="https://etherscan.io/address/0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D"
          target="_blank"
          rel="noreferrer noopener"
          className="text-gold underline-offset-2 hover:underline"
        >
          BAYC
        </a>{" "}
        and{" "}
        <a
          href="https://etherscan.io/address/0x60E4d786628Fea6478F785A6d7e704777c86a7c6"
          target="_blank"
          rel="noreferrer noopener"
          className="text-gold underline-offset-2 hover:underline"
        >
          MAYC
        </a>{" "}
        on Ethereum mainnet via a live <code>balanceOf</code> call. Hold either collection and
        you're verified immediately — no extra signature needed.
      </>
    ),
  },
  {
    n: "03",
    icon: ShieldCheck,
    title: "Delegate.cash vaults are auto-walked",
    body: (
      <>
        If your signer wallet doesn't hold an ape, BAYCMC asks the{" "}
        <a
          href="https://etherscan.io/address/0x00000000000000447e69651d841bD8D104Bed493"
          target="_blank"
          rel="noreferrer noopener"
          className="text-gold underline-offset-2 hover:underline"
        >
          delegate.cash v2 registry
        </a>{" "}
        for every vault that delegated to you (ALL or BAYC/MAYC-scoped, no-rights filter) and
        checks each one. Cold-wallet holders get full access without exposing their vault.
      </>
    ),
  },
  {
    n: "04",
    icon: Wallet,
    title: "Link additional wallets (optional)",
    body: (
      <>
        Hold your ape on a wallet you don't sign in with — and don't use delegate.cash? Add it
        below. Each linked wallet must sign a one-time challenge to prove control, then BAYCMC
        walks it on-chain alongside the signer wallet and every incoming delegation.
      </>
    ),
  },
  {
    n: "05",
    icon: DoorOpen,
    title: "Doors open",
    body: (
      <>
        Once any path returns a positive balance, gated menu items appear automatically: Holders
        Chat, Conference Rooms, Ape Rides, and (with Otherpage) Lifer Chat. Transfer an ape or
        revoke a delegation and the next page navigation drops you back to the lobby — verification
        is live, not a one-time stamp.
      </>
    ),
  },
];

function VerifyPage() {
  const { isAuthenticated, loading } = useAuth();
  const { isVerifiedHolder, isLifer, collection, loading: verifLoading } = useVerificationStatus();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <header className="text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-gold">
          <ShieldCheck className="h-3 w-3" /> VIP onboarding
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold sm:text-5xl">
          Verify your <span className="text-gradient-gold">Bored Ape</span> end-to-end
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground sm:text-base">
          Five live steps. Every check runs against mainnet at request time — no cached snapshots,
          no manual approvals. Production-grade.
        </p>
      </header>

      {/* Live status banner */}
      <section className="mt-8">
        {loading || verifLoading ? (
          <div className="rounded-xl border border-border bg-secondary/20 px-4 py-4 text-sm text-muted-foreground">
            Checking your session…
          </div>
        ) : !isAuthenticated ? (
          <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-gold/30 bg-gold/5 px-4 py-4 text-sm sm:flex-row">
            <div>
              <div className="font-semibold">Not signed in yet</div>
              <div className="text-muted-foreground">
                Sign in to run the live ownership check against your wallet.
              </div>
            </div>
            <Link
              to="/"
              className="rounded-md bg-gradient-gold px-3 py-1.5 text-sm font-semibold text-gold-foreground shadow-gold"
            >
              Go to sign-in
            </Link>
          </div>
        ) : isVerifiedHolder ? (
          <div className="flex flex-col items-center justify-between gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-4 text-sm sm:flex-row">
            <div>
              <div className="font-semibold text-success">
                Verified {collection ? `${collection} holder` : "holder"}
                {isLifer && " · Lifer"}
              </div>
              <div className="text-muted-foreground">
                Gated menu items are unlocked. Welcome inside.
              </div>
            </div>
            <Link
              to="/feed"
              className="rounded-md bg-gradient-gold px-3 py-1.5 text-sm font-semibold text-gold-foreground shadow-gold"
            >
              Enter the clubhouse
            </Link>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-secondary/20 px-4 py-4 text-sm">
            <div className="font-semibold">Not yet verified</div>
            <div className="text-muted-foreground">
              We didn't find BAYC or MAYC on your signer wallet or any delegated vault. Add a
              linked wallet below if your ape is on another address.
            </div>
          </div>
        )}
      </section>

      {/* Steps */}
      <ol className="mt-10 space-y-4">
        {STEPS.map((s) => {
          const Icon = s.icon;
          return (
            <li
              key={s.n}
              className="rounded-2xl border border-border bg-card/30 p-5 shadow-card sm:p-6"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/10 text-gold">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-mono text-[11px] uppercase tracking-widest text-gold">
                    Step {s.n}
                  </div>
                  <h2 className="mt-0.5 font-display text-lg font-semibold sm:text-xl">
                    {s.title}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Live panels — signed-in only */}
      {isAuthenticated && !loading && (
        <section className="mt-10 space-y-4">
          <h2 className="font-display text-xl font-semibold">Live verification</h2>
          <VerificationStatusPanel />
          <LinkedWalletsPanel />
        </section>
      )}

      <footer className="mt-12 border-t border-border/50 pt-6 text-center text-xs text-muted-foreground">
        <a
          href="https://delegate.xyz"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          Learn about delegate.cash <ExternalLink className="h-3 w-3" />
        </a>
      </footer>
    </main>
  );
}
