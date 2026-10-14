import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImageOff, Loader2, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { listWalletNfts, type NftItem } from "@/server/wallet-assets.functions";
import { listLinkedWallets } from "@/lib/linked-wallets.functions";

export function AvatarPicker({
  open,
  onOpenChange,
  primaryWallet,
  onPickDevice,
  onPickNft,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  primaryWallet: string;
  onPickDevice: () => void;
  onPickNft: (nft: NftItem) => void;
}) {
  const listNfts = useServerFn(listWalletNfts);
  const listLinked = useServerFn(listLinkedWallets);
  const [items, setItems] = useState<NftItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || items) return;
    let cancelled = false;
    void (async () => {
      try {
        const linked = await listLinked().catch(() => ({ wallets: [] as { address: string; verified_at: string | null }[] }));
        const addrs = new Set<string>();
        if (primaryWallet) addrs.add(primaryWallet.toLowerCase());
        for (const w of linked.wallets as { address: string; verified_at: string | null }[]) {
          if (w.verified_at) addrs.add(w.address.toLowerCase());
        }
        const results = await Promise.all(
          [...addrs].map((address) => listNfts({ data: { address } }).catch(() => null)),
        );
        if (cancelled) return;
        const seen = new Set<string>();
        const all: NftItem[] = [];
        for (const r of results) {
          if (!r?.ok) continue;
          for (const n of r.items) {
            const k = `${n.contract}-${n.tokenId}`;
            if (!n.image || seen.has(k)) continue;
            seen.add(k);
            all.push(n);
          }
        }
        setItems(all);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load NFTs");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, items, primaryWallet, listNfts, listLinked]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose profile picture</DialogTitle>
        </DialogHeader>
        <button
          type="button"
          onClick={onPickDevice}
          className="flex w-full items-center gap-3 rounded-lg border border-border bg-secondary/30 px-4 py-3 text-left text-sm font-medium hover:border-gold/50"
        >
          <Smartphone className="h-4 w-4 text-gold" /> Upload from your device
        </button>
        <div className="mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          From your NFTs
        </div>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !items ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your NFTs…
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageOff className="h-4 w-4" /> No NFTs from supported collections found.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((n) => (
              <button
                key={`${n.contract}-${n.tokenId}`}
                type="button"
                onClick={() => onPickNft(n)}
                className="aspect-square overflow-hidden rounded-md border-2 border-border hover:border-gold"
                title={n.name ?? `#${n.tokenId}`}
              >
                <img src={n.image!} alt={n.name ?? n.tokenId} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
