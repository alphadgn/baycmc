import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Copy, LogOut, User as UserIcon, Activity } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut } from "@/lib/auth/useAuth";
import { toast } from "sonner";

interface WalletPillProps {
  address: string;
  collection: "BAYC" | "MAYC" | null;
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
    const hue2 = (h2 % 360 + 120) % 360;
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

export function WalletPill({ address, collection }: WalletPillProps) {
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
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-gold/30 bg-secondary/40 px-2.5 pr-3 text-xs font-mono text-foreground transition hover:border-gold/60 hover:bg-secondary/70"
          aria-label="Wallet menu"
        >
          <AddressAvatar address={address} />
          <span className="tabular-nums">{sliceAddress(address)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-72 border-gold/20 bg-popover p-0"
      >
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
            to="/ape-rides"
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
