import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { listWalletNfts, type NftItem } from "@/server/wallet-assets.functions";

export function NftGallery({ address }: { address: string }) {
  const listFn = useServerFn(listWalletNfts);
  const [items, setItems] = useState<NftItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await listFn({ data: { address } });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.reason ?? "Couldn't load NFTs");
          setItems([]);
        } else {
          setItems(res.items);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load NFTs");
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, listFn]);

  if (loading) {
    return (
      <div className="glass rounded-2xl p-6 shadow-card">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading your NFTs from Alchemy…
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted/30" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !items || items.length === 0) {
    return (
      <div className="glass rounded-2xl p-6 shadow-card">
        <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
          <ImageOff className="mb-2 h-6 w-6 text-muted-foreground" />
          {error ? `Couldn't load NFTs — ${error}` : "No NFTs found in this wallet yet."}
        </div>
      </div>
    );
  }

  // Group by collection for a tidy display.
  const grouped = items.reduce<Record<string, NftItem[]>>((acc, n) => {
    const key = n.collection ?? "Other";
    (acc[key] ??= []).push(n);
    return acc;
  }, {});
  const collections = Object.keys(grouped).sort(
    (a, b) => grouped[b].length - grouped[a].length || a.localeCompare(b),
  );

  return (
    <div className="space-y-6">
      {collections.map((col) => (
        <section key={col} className="glass rounded-2xl p-6 shadow-card">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg font-semibold">{col}</h3>
            <span className="text-xs text-muted-foreground">
              {grouped[col].length} {grouped[col].length === 1 ? "item" : "items"}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {grouped[col].map((nft) => (
              <NftCard key={`${nft.contract}-${nft.tokenId}`} nft={nft} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function NftCard({ nft }: { nft: NftItem }) {
  const [imgError, setImgError] = useState(false);
  const title = nft.name ?? `#${nft.tokenId}`;
  return (
    <a
      href={nft.openseaUrl}
      target="_blank"
      rel="noreferrer"
      className="group relative overflow-hidden rounded-xl border border-border/60 bg-card/30 transition hover:border-gold/40"
    >
      <div className="aspect-square bg-muted/20">
        {nft.image && !imgError ? (
          <img
            src={nft.image}
            alt={title}
            loading="lazy"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover transition group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border/50 px-3 py-2">
        <span className="truncate text-xs font-medium" title={title}>
          {title}
        </span>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
      </div>
    </a>
  );
}
