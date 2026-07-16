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

/**
 * UI for managing additional wallets linked to the user's account.
 *
 * The "Add wallet" flow uses the MetaMask SDK directly so adding an extra
 * holder wallet never opens Glyph's primary sign-in modal.
 */
export function LinkedWalletsPanel() {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-5">
      <LinkedWalletsPanelInner />
    </div>
  );
}

type MetaMaskProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

function LinkedWalletsPanelInner() {
  const [rows, setRows] = useState<LinkedWalletRow[]>([]);
  const [loading, setLoading] = useState(true);
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

  async function handleAddWalletClick() {
    setErr(null);
    setBusy(true);
    let sdk: { getProvider: () => MetaMaskProvider | undefined; terminate?: () => Promise<void> } | null =
      null;
    try {
      await import("@/lib/polyfill-shim").then((m) => m.installBrowserPolyfills());
      const { MetaMaskSDK } = await import("@metamask/sdk");
      sdk = new MetaMaskSDK({
        dappMetadata: {
          name: "BAYCmc",
          url: window.location.origin,
        },
        checkInstallationImmediately: false,
        enableAnalytics: false,
        extensionOnly: false,
      });

      const accounts = await sdk.connect();
      const target = accounts[0];
      if (!target) throw new Error("No account returned from wallet");

      const { message, nonce } = await requestNonce({ data: { address: target } });
      const provider = sdk.getProvider();
      if (!provider) throw new Error("MetaMask provider unavailable");
      const signature = await provider.request({
        method: "personal_sign",
        params: [message, target],
      });
      if (typeof signature !== "string") throw new Error("No signature returned from MetaMask");

      const res = await verify({
        data: {
          address: target,
          nonce,
          signature,
          label: "MetaMask",
        },
      });
      if (!res.ok) throw new Error("Verification failed");
      toast.success("Wallet linked. Refreshing ownership…");
      window.dispatchEvent(new Event("baycmc:verification-refresh"));
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to link wallet";
      setErr(msg);
      toast.error(msg);
    } finally {
      try {
        await sdk?.terminate?.();
      } catch {
        /* non-fatal */
      }
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
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-gold" />
          <div className="text-lg font-semibold">Linked wallets</div>
        </div>
        <button
          type="button"
          onClick={handleAddWalletClick}
          disabled={busy}
          aria-label="Add wallet with MetaMask"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-gold-foreground ring-1 ring-gold/50 transition hover:brightness-110 active:brightness-95 disabled:opacity-60"
          style={{ background: "var(--gradient-gold)", boxShadow: "var(--shadow-gold)" }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add wallet
        </button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Attach additional wallets to your account. Each is checked on-chain for BAYC / MAYC
        (and incoming delegate.cash delegations) on every sign-in.
      </p>

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

      {err && (
        <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
          {err}
        </div>
      )}
    </>
  );
}
