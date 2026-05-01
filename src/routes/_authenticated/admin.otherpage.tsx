import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getOtherpageGate, setOtherpageGate } from "@/server/verification.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/otherpage")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    if (!roles?.some((r) => r.role === "super_admin")) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({ meta: [{ title: "Admin · Otherpage Gate" }] }),
  component: OtherpageAdmin,
});

function OtherpageAdmin() {
  const [contract, setContract] = useState("");
  const [minBalance, setMinBalance] = useState(1);
  const [chainId, setChainId] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const get = useServerFn(getOtherpageGate);
  const save = useServerFn(setOtherpageGate);

  useEffect(() => {
    void (async () => {
      const res = await get({});
      if (res.gate) {
        setContract(res.gate.contract ?? "");
        setMinBalance(res.gate.min_balance);
        setChainId(res.gate.chain_id);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await save({ data: { contract, minBalance, chainId } });
    setBusy(false);
    if (res.ok) toast.success("Otherpage gate updated");
    else toast.error(res.error || "Failed");
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-5xl text-gradient-gold">Otherpage Gate</h1>
      <p className="mt-1 text-sm text-muted-foreground font-sans-display">
        Configure the secondary token contract that grants Lifer status.
      </p>

      {loading ? (
        <div className="mt-6 h-48 animate-pulse rounded-2xl bg-muted/20" />
      ) : (
        <form onSubmit={submit} className="glass mt-6 space-y-4 rounded-2xl p-6 shadow-card">
          <div>
            <label className="block text-xs uppercase tracking-wider text-muted-foreground">
              Contract address
            </label>
            <input
              required
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              placeholder="0x…"
              className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 font-mono text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                Min balance
              </label>
              <input
                type="number"
                min={1}
                value={minBalance}
                onChange={(e) => setMinBalance(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider text-muted-foreground">
                Chain ID
              </label>
              <input
                type="number"
                value={chainId}
                onChange={(e) => setChainId(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-gradient-gold px-4 py-3 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50 font-sans-display"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      )}
    </main>
  );
}
