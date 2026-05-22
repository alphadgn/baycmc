import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Main Entrance — BAYCMC" },
      {
        name: "description",
        content:
          "Sign in with email and password to enter the BAYCMC lobby. No wallet required for unverified clubhouse areas.",
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
        toast.success("Welcome back.");
        void navigate({ to: "/lobby", replace: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign-in failed.";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="glass rounded-2xl border border-gold/20 p-6 shadow-card sm:p-8">
        <h1 className="font-display text-2xl font-bold sm:text-3xl">Main Entrance</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sign in with email and password to enter the lobby. Verified holders should use the{" "}
          <span className="font-semibold text-gold">VIP</span> entrance in the top-right instead.
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
          {mode === "signin" ? (
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
                onClick={() => setMode("signin")}
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
