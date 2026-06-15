import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Trash2, CheckCircle2, Wallet } from "lucide-react";
import {
  listLinkedWallets,
  requestLinkedWalletNonce,
  verifyAndLinkWallet,
  removeLinkedWallet,
} from "@/lib/linked-wallets.functions";
import { toast } from "sonner";

interface LinkedWalletRow {
  id: string;
  address: string;
  label: string | null;
  verified_at: string | null;
  last_checked_at: string | null;
  created_at: string;
}

interface InjectedProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}
function getInjectedProvider(): InjectedProvider | null {
  const w = window as unknown as { ethereum?: InjectedProvider };
  return w.ethereum ?? null;
}


/**
 * UI for managing additional wallets linked to the user's account.
 *
 * Each wallet must prove control via a personal_sign challenge before the
 * server walks it for BAYC/MAYC ownership. The signature happens through any
 * EIP-1193 provider (`window.ethereum`) — e.g. MetaMask, Rainbow,
 * WalletConnect-injected providers. The flow does NOT require switching the
 * primary BAYCMC session wallet.
 */
export function LinkedWalletsPanel() {
  const [rows, setRows] = useState<LinkedWalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addr, setAddr] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const list = useServerFn(listLinkedWallets);
  const requestNonce = useServerFn(requestLinkedWalletNonce);
  const verify = useServerFn(verifyAndLinkWallet);
  const remove = useServerFn(removeLinkedWallet);

  async function reload() {
    setLoading(true);
    try {
      const res = await list();
      setRows(res.wallets as LinkedWalletRow[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load linked wallets");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd() {
    setErr(null);
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr.trim())) {
      setErr("Enter a valid Ethereum address (0x…40 hex chars)");
      return;
    }
    if (!window.ethereum) {
      setErr(
        "No browser wallet detected. Open this page in a browser with MetaMask, Rainbow, or another EIP-1193 wallet to sign the link challenge.",
      );
      return;
    }
    setBusy(true);
    try {
      const target = addr.trim();
      const { message, nonce } = await requestNonce({ data: { address: target } });
      // Ask the injected provider to sign with the target wallet. The user
      // must have switched the active account in the wallet extension to
      // match `target` — we do NOT trust eth_accounts since the linked
      // wallet is by definition distinct from the BAYCMC sign-in wallet.
      const signature = (await window.ethereum.request({
        method: "personal_sign",
        params: [message, target],
      })) as string;
      const res = await verify({
        data: { address: target, nonce, signature, label: label.trim() || undefined },
      });
      if (!res.ok) throw new Error("Verification failed");
      toast.success("Wallet linked. Refreshing ownership…");
      window.dispatchEvent(new Event("baycmc:verification-refresh"));
      setAddOpen(false);
      setAddr("");
      setLabel("");
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to link wallet";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(address: string) {
    if (!window.confirm("Remove this linked wallet? It will no longer count toward verification."))
      return;
    try {
      await remove({ data: { address } });
      toast.success("Wallet unlinked");
      window.dispatchEvent(new Event("baycmc:verification-refresh"));
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    }
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gold" />
          <div className="text-lg font-semibold">Linked wallets</div>
        </div>
        <button
          onClick={() => setAddOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border border-gold/40 bg-gold/10 px-2 py-1 text-xs font-semibold text-gold hover:bg-gold/20"
        >
          <Plus className="h-3 w-3" /> Add wallet
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Attach additional wallets to your account. Each is checked on-chain for BAYC / MAYC
        (and incoming delegate.cash delegations) on every sign-in.
      </p>

      {addOpen && (
        <div className="mt-4 rounded-md border border-border bg-background/40 p-3">
          <label className="block text-xs font-semibold text-muted-foreground">Wallet address</label>
          <input
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            autoComplete="off"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-mono"
          />
          <label className="mt-3 block text-xs font-semibold text-muted-foreground">
            Label (optional)
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Vault, hardware wallet, etc."
            maxLength={64}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          {err && (
            <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {err}
            </div>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setAddOpen(false)}
              disabled={busy}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-md bg-gradient-gold px-3 py-1.5 text-xs font-semibold text-gold-foreground disabled:opacity-50"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              {busy ? "Waiting for signature…" : "Sign & link"}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Switch the active account in your wallet extension to{" "}
            <span className="font-mono">{addr || "0x…"}</span> before clicking Sign &amp; link.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
            No additional wallets linked yet.
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/40 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {row.verified_at ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <span className="truncate font-mono text-xs">{row.address}</span>
                </div>
                {row.label && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{row.label}</div>
                )}
              </div>
              <button
                onClick={() => handleRemove(row.address)}
                className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove linked wallet"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
