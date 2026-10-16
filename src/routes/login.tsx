import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Main Entrance — BAYCmc" },
      {
        name: "description",
        content:
          "Sign in with email and password to enter the BAYCmc lobby. No wallet required for unverified clubhouse areas.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // After a failed email/password sign-in we swap "No account? Create one"
  // for a "Forgot your password?" reset link.
  const [signInFailed, setSignInFailed] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (!loading && isAuthenticated) {
      void navigate({ to: "/lobby", replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/lobby` },
        });
        if (error) throw error;
        toast.success("Account created. Check your inbox to confirm your email.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        // New session → re-check every linked wallet on-chain from scratch;
        // nothing from a previous session is trusted.
        try {
          const { startVerificationSession } = await import("@/server/verification.functions");
          await startVerificationSession();
          window.dispatchEvent(new Event("baycmc:verification-refresh"));
        } catch (e) {
          console.warn("[login] fresh verification failed", e);
        }
        toast.success("Welcome back.");
        void navigate({ to: "/lobby", replace: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      if (mode === "signin") setSignInFailed(true);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  async function sendReset() {
    const addr = email.trim();
    if (!addr) {
      toast.error("Enter your email above first.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(addr, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setResetSent(true);
    toast.success("Password reset link sent. Check your inbox.");
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="glass rounded-2xl border border-gold/20 p-6 shadow-card sm:p-8">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Main Entrance</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with email and password to enter the lobby. Prefer Glyph or a wallet? Tap{" "}
          <span className="font-semibold text-gold">VIP</span> at the top. Holders unlock the gated
          rooms by signing in with (or linking) the wallet that holds their NFTs.
        </p>

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Email
            </label>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-gold/60"
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Password
            </label>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-secondary/30 px-3 py-2 text-sm outline-none focus:border-gold/60"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-gradient-gold px-4 py-2.5 text-sm font-semibold text-gold-foreground shadow-gold transition hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
          >
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="mt-4 text-center text-xs text-muted-foreground">
          {mode === "signin" && signInFailed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void sendReset()}
              className="font-semibold text-gold hover:underline disabled:opacity-60"
            >
              {resetSent ? "Reset link sent — send again?" : "Forgot your password?"}
            </button>
          ) : mode === "signin" ? (
            <>
              No account?{" "}
              <button
                type="button"
                onClick={() => setMode("signup")}
                className="font-semibold text-gold hover:underline"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already a member?{" "}
              <button
                type="button"
                onClick={() => {
                  setMode("signin");
                  setSignInFailed(false);
                }}
                className="font-semibold text-gold hover:underline"
              >
                Sign in
              </button>
            </>
          )}
        </div>

        <div className="mt-6 border-t border-border/60 pt-4 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
