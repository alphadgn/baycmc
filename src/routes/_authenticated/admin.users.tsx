import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  listUsers,
  overrideVerification,
  getMyAdminContext,
} from "@/server/admin.functions";

interface UserRow {
  id: string;
  wallet_address: string;
  username: string | null;
  avatar_url: string | null;
  created_at: string;
  roles: string[];
  verification: {
    bayc_verified: boolean;
    otherpage_verified: boolean;
  } | null;
}

export const Route = createFileRoute("/_authenticated/admin/users")({
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
  head: () => ({ meta: [{ title: "Admin · Users — BAYCMC" }] }),
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const list = useServerFn(listUsers);
  const override = useServerFn(overrideVerification);
  const myCtx = useServerFn(getMyAdminContext);
  const [isSuper, setIsSuper] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    const res = await list({ data: { search, limit: 200 } });
    setUsers(res.users as UserRow[]);
    setLoading(false);
  }, [list, search]);

  useEffect(() => {
    void myCtx({ data: {} as never }).then((r) => setIsSuper(r.isSuperAdmin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live search — re-query (debounced) as the admin types so the results
  // narrow in place instead of waiting for Enter / the Search button.
  useEffect(() => {
    const t = window.setTimeout(() => void run(), 250);
    return () => window.clearTimeout(t);
  }, [run]);

  async function toggleVerify(u: UserRow, key: "bayc_verified" | "otherpage_verified") {
    setBusy(u.id);
    try {
      const next = !(u.verification?.[key] ?? false);
      await override({ data: { targetUserId: u.id, [key]: next } });
      await run();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-gradient-gold sm:text-5xl">
            Admin · Users
          </h1>
          <p className="mt-1 text-xs text-muted-foreground font-sans-display sm:text-sm">
            Override verification and allow access for any member
          </p>
        </div>
        <nav className="flex gap-2 text-xs font-sans-display">
          <Link to="/admin" className="rounded-md border border-border px-3 py-2 hover:bg-muted">
            Audit
          </Link>
          {isSuper && (
            <Link
              to="/super-admin"
              className="rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-gold hover:bg-gold/20"
            >
              Super Admin
            </Link>
          )}
        </nav>
      </header>

      <div className="glass mb-4 flex flex-wrap items-end gap-3 rounded-2xl p-4 shadow-card">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-[11px] text-muted-foreground">Search wallet / username</label>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            placeholder="0x… or name"
          />
        </div>
        <button
          onClick={run}
          className="rounded-md bg-gradient-gold px-4 py-2 text-xs font-semibold text-gold-foreground shadow-gold font-sans-display"
        >
          Search
        </button>
      </div>

      <div className="glass overflow-x-auto rounded-2xl shadow-card">
        <table className="w-full text-left text-xs font-sans-display">
          <thead className="border-b border-border/60 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Wallet</th>
              <th className="px-4 py-3">Roles</th>
              <th className="px-4 py-3">BAYC</th>
              <th className="px-4 py-3">Otherpage</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="border-b border-border/30">
                  <td className="px-4 py-2">{u.username ?? "—"}</td>
                  <td className="px-4 py-2 font-mono text-[10px]">
                    {u.wallet_address.slice(0, 6)}…{u.wallet_address.slice(-4)}
                  </td>
                  <td className="px-4 py-2">
                    {u.roles.length ? (
                      <div className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <span key={r} className="rounded bg-gold/10 px-1.5 py-0.5 text-[10px] text-gold">
                            {r}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      disabled={busy === u.id}
                      onClick={() => toggleVerify(u, "bayc_verified")}
                      className={`rounded px-2 py-1 text-[10px] ${
                        u.verification?.bayc_verified
                          ? "bg-emerald-600/20 text-emerald-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {u.verification?.bayc_verified ? "✓ Allowed" : "Denied"}
                    </button>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      disabled={busy === u.id}
                      onClick={() => toggleVerify(u, "otherpage_verified")}
                      className={`rounded px-2 py-1 text-[10px] ${
                        u.verification?.otherpage_verified
                          ? "bg-emerald-600/20 text-emerald-300"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {u.verification?.otherpage_verified ? "✓ Allowed" : "Denied"}
                    </button>
                  </td>
                  <td className="px-4 py-2 font-mono text-[10px]">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
