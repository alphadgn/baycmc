import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useConnect, useSignMessage, useDisconnect, useAccount } from "wagmi";
import { Loader2, Plus, Trash2, CheckCircle2, Wallet, X } from "lucide-react";
import { useGlyphReady } from "@/components/GlyphAppProvider";
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
 * The "Add wallet" flow opens a wallet-connect picker (via wagmi connectors
 * mounted by the Glyph provider) so mobile users can attach a wallet through
 * WalletConnect / Coinbase / MetaMask deep-links, rather than requiring an
 * injected `window.ethereum` provider.
 */
export function LinkedWalletsPanel() {
  const ready = useGlyphReady();

  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-5">
      {ready ? (
        <LinkedWalletsPanelInner />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading wallet connector…
        </div>
      )}
    </div>
  );
}

function LinkedWalletsPanelInner() {
  const [rows, setRows] = useState<LinkedWalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [step, setStep] = useState<"pick" | "signing">("pick");

  const list = useServerFn(listLinkedWallets);
  const requestNonce = useServerFn(requestLinkedWalletNonce);
  const verify = useServerFn(verifyAndLinkWallet);
  const remove = useServerFn(removeLinkedWallet);

  const { connectors, connectAsync } = useConnect();
  const { signMessageAsync } = useSignMessage();
  const { disconnectAsync } = useDisconnect();
  const { address: connectedAddress, connector: activeConnector } = useAccount();

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

  function openAdd() {
    setErr(null);
    setLabel("");
    setStep("pick");
    setAddOpen(true);
  }

  function closeAdd() {
    if (busy) return;
    setAddOpen(false);
    setErr(null);
  }

  async function handlePickConnector(connectorId: string) {
    setErr(null);
    const chosen = connectors.find((c) => c.id === connectorId);
    if (!chosen) {
      setErr("Connector unavailable");
      return;
    }
    setBusy(true);
    setStep("signing");
    const previousConnector = activeConnector;
    let connectedForLink: { address: string; connectorId: string } | null = null;
    try {
      const result = await connectAsync({ connector: chosen });
      const target = result.accounts[0];
      if (!target) throw new Error("No account returned from wallet");
      connectedForLink = { address: target, connectorId: chosen.id };

      const { message, nonce } = await requestNonce({ data: { address: target } });
      const signature = await signMessageAsync({ account: target, message });

      const res = await verify({
        data: {
          address: target,
          nonce,
          signature,
          label: label.trim() || undefined,
        },
      });
      if (!res.ok) throw new Error("Verification failed");
      toast.success("Wallet linked. Refreshing ownership…");
      window.dispatchEvent(new Event("baycmc:verification-refresh"));
      setAddOpen(false);
      setLabel("");
      await reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to link wallet";
      setErr(msg);
      setStep("pick");
    } finally {
      // Disconnect the ad-hoc connector so the primary Glyph session isn't
      // replaced. If the user linked their existing session wallet somehow,
      // leave it connected.
      if (
        connectedForLink &&
        (!previousConnector || previousConnector.id !== connectedForLink.connectorId)
      ) {
        try {
          await disconnectAsync({ connector: chosen });
        } catch {
          /* non-fatal */
        }
      }
      setBusy(false);
    }
  }

  function handleAddWalletClick() {
    // Prefer MetaMask / injected connector so mobile users go straight to
    // the wallet's connect prompt (via deep-link on iOS/Android), skipping
    // the Glyph login modal. Fall back to the connector picker only if no
    // injected/MetaMask connector is registered.
    const pick =
      connectors.find((c) => c.id === "metaMask" || c.id === "metamask") ??
      connectors.find((c) => c.id === "injected") ??
      connectors.find((c) => /metamask/i.test(c.name)) ??
      connectors.find((c) => /injected/i.test(c.name));
    if (pick) {
      setErr(null);
      setLabel("");
      void handlePickConnector(pick.id);
      return;
    }
    openAdd();
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
      <div className="flex items-center gap-2">
        <Wallet className="h-4 w-4 text-gold" />
        <div className="text-lg font-semibold">Linked wallets</div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Attach additional wallets to your account. Each is checked on-chain for BAYC / MAYC
        (and incoming delegate.cash delegations) on every sign-in.
      </p>

      <button
        type="button"
        onClick={handleAddWalletClick}
        disabled={busy}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-gold px-6 py-3 text-sm font-semibold text-gold-foreground shadow-lg ring-1 ring-gold/40 transition hover:brightness-110 active:brightness-95 disabled:opacity-60 sm:w-auto"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add wallet
      </button>

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

      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={closeAdd}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-gold/30 bg-background p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold">Connect a wallet to link</div>
              <button
                type="button"
                onClick={closeAdd}
                disabled={busy}
                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Choose how to connect. We'll ask that wallet to sign a link challenge — no on-chain
              transaction, no gas.
            </p>

            <label className="mt-4 block text-xs font-semibold text-muted-foreground">
              Label (optional)
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Vault, hardware wallet, etc."
              maxLength={64}
              disabled={busy}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />

            <div className="mt-4 space-y-2">
              {connectors.length === 0 ? (
                <div className="rounded-md border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
                  No wallet connectors are available in this environment.
                </div>
              ) : (
                connectors.map((c) => (
                  <button
                    key={c.uid}
                    type="button"
                    disabled={busy}
                    onClick={() => handlePickConnector(c.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-3 text-left text-sm font-medium transition hover:border-gold/40 hover:bg-secondary/60 disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2">
                      {c.icon ? (
                        <img src={c.icon} alt="" className="h-5 w-5 rounded" />
                      ) : (
                        <Wallet className="h-5 w-5 text-gold" />
                      )}
                      {c.name}
                    </span>
                    {busy && step === "signing" ? (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Plus className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                ))
              )}
            </div>

            {err && (
              <div className="mt-3 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                {err}
              </div>
            )}

            {busy && step === "signing" && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Waiting for signature from your wallet…
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
