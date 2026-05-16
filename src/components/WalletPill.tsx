import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Activity, ChevronDown, Copy, Loader2, Lock, LogOut, User as UserIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut } from "@/lib/auth/useAuth";
import { toast } from "sonner";

interface WalletPillProps {
  address: string;
  collection: "BAYC" | "MAYC" | null;
  /** Lobby users (Tier 1) get a "Verify holder access" dropdown item that
   *  triggers a fresh Privy signature + on-chain ownership check. */
  isVerifiedHolder?: boolean;
  onVerify?: () => void;
  verifying?: boolean;
}

function sliceAddress(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Deterministic gradient avatar derived from the address. */
function AddressAvatar({ address, size = 20 }: { address: string; size?: number }) {
  const { c1, c2, angle } = useMemo(() => {
    const a = address.toLowerCase().replace(/^0x/, "");
    const h1 = parseInt(a.slice(0, 6) || "0", 16);
    const h2 = parseInt(a.slice(6, 12) || "0", 16);
    const h3 = parseInt(a.slice(12, 18) || "0", 16);
    const hue1 = h1 % 360;
    const hue2 = ((h2 % 360) + 120) % 360;
    return {
      c1: `hsl(${hue1} 80% 55%)`,
      c2: `hsl(${hue2} 80% 45%)`,
      angle: h3 % 360,
    };
  }, [address]);
  return (
    <span
      aria-hidden
      className="inline-block rounded-full ring-1 ring-gold/30"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(${angle}deg, ${c1}, ${c2})`,
      }}
    />
  );
}

export function WalletPill({
  address,
  collection,
  isVerifiedHolder = collection !== null,
  onVerify,
  verifying = false,
}: WalletPillProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy address");
    }
  }

  async function handleDisconnect() {
    await signOut();
    setOpen(false);
    toast.success("Disconnected");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-gold/30 bg-secondary/40 px-2.5 pr-3 font-mono text-xs text-foreground transition hover:border-gold/60 hover:bg-secondary/70"
          aria-label="Wallet menu"
        >
          <AddressAvatar address={address} />
          <span className="tabular-nums">{sliceAddress(address)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-72 border-gold/20 bg-popover p-0">
        <div className="flex items-center gap-3 border-b border-border/60 p-4">
          <AddressAvatar address={address} size={36} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-xs text-foreground">
                {sliceAddress(address)}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="cursor-pointer rounded p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                aria-label="Copy address"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Ethereum Mainnet
            </div>
          </div>
        </div>

        {collection && (
          <div className="px-4 py-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-2.5 py-1 text-[11px] font-semibold text-gold">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              {collection} verified
            </span>
          </div>
        )}

        {!isVerifiedHolder && onVerify && (
          <div className="px-4 py-3">
            <button
              type="button"
              disabled={verifying}
              onClick={() => {
                onVerify();
                setOpen(false);
              }}
              className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-gold/40 bg-gold/10 px-3 py-2 text-xs font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-wait disabled:opacity-70"
            >
              {verifying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lock className="h-3.5 w-3.5" />
              )}
              {verifying ? "Verifying…" : "Verify holder access"}
            </button>
            <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
              Re-checks BAYC/MAYC ownership on-chain (direct or via delegate.cash). You'll be asked
              to sign a message.
            </p>
          </div>
        )}

        <div className="px-2 pb-2">
          <Link
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition hover:bg-secondary"
          >
            <UserIcon className="h-4 w-4 text-muted-foreground" />
            View profile
          </Link>
          <Link
            to="/activity"
            onClick={() => setOpen(false)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition hover:bg-secondary"
          >
            <Activity className="h-4 w-4 text-muted-foreground" />
            My activity
          </Link>
        </div>

        <div className="border-t border-border/60 p-2">
          <button
            type="button"
            onClick={handleDisconnect}
            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive transition hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            Disconnect
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
