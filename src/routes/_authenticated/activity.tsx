import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Sparkles,
  Coins,
  TrendingUp,
  Calendar,
} from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { listWalletActivity, type ActivityItem } from "@/server/wallet-assets.functions";

export const Route = createFileRoute("/_authenticated/activity")({
  head: () => ({
    meta: [
      { title: "My Activity — BAYCMC" },
      {
        name: "description",
        content:
          "Recent on-chain transactions for your wallet, mint history, and frequency analytics.",
      },
    ],
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<string | null>(null);
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchActivity = useServerFn(listWalletActivity);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("wallet_address")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setWallet(data?.wallet_address ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetchActivity({ data: { address: wallet } });
        if (cancelled) return;
        if (!res.ok) {
          setError(res.reason ?? "Couldn't load activity");
          setItems([]);
        } else {
          setItems(res.items);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Couldn't load activity");
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, fetchActivity]);

  const analytics = useMemo(() => computeAnalytics(items ?? [], wallet ?? ""), [items, wallet]);

  if (!user || !wallet) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          <p className="mt-2">Loading your wallet…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">My activity</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          On-chain transactions for{" "}
          <span className="font-mono">
            {wallet.slice(0, 6)}…{wallet.slice(-4)}
          </span>{" "}
          · sourced from Alchemy Transfers API.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<TrendingUp className="h-4 w-4" />}
          label="Total transactions"
          value={loading ? "…" : analytics.total.toString()}
          sub={
            analytics.last30 > 0 ? `${analytics.last30} in last 30 days` : "across recent history"
          }
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          label="NFT mints"
          value={loading ? "…" : analytics.mints.toString()}
          sub="ERC-721/1155 from 0x0"
        />
        <StatCard
          icon={<Coins className="h-4 w-4" />}
          label="ETH out"
          value={loading ? "…" : analytics.ethOut.toFixed(3)}
          sub="ETH sent"
        />
        <StatCard
          icon={<Calendar className="h-4 w-4" />}
          label="Most active day"
          value={loading ? "…" : (analytics.busiestDay ?? "—")}
          sub={analytics.busiestDayCount ? `${analytics.busiestDayCount} txs` : "no data yet"}
        />
      </section>

      <section className="mt-8 glass rounded-2xl p-6 shadow-card">
        <div className="flex items-baseline justify-between">
          <h2 className="font-display text-xl font-semibold">Last 90 days</h2>
          <span className="text-xs text-muted-foreground">
            {analytics.chart.reduce((s, d) => s + d.count, 0)} txs
          </span>
        </div>
        <div className="mt-4 h-48">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : analytics.chart.every((d) => d.count === 0) ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              No transactions in the last 90 days.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={analytics.chart}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={6} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "hsl(var(--foreground))" }}
                />
                <Bar dataKey="count" fill="#F5B100" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="mt-8 glass rounded-2xl shadow-card">
        <div className="flex items-baseline justify-between border-b border-border/50 px-6 py-4">
          <h2 className="font-display text-xl font-semibold">Recent transactions</h2>
          <span className="text-xs text-muted-foreground">{items?.length ?? 0} shown</span>
        </div>
        {loading ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            <p className="mt-2">Loading recent transfers…</p>
          </div>
        ) : error || !items || items.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            {error ? `Couldn't load activity — ${error}` : "No recent activity for this wallet."}
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {items.map((it) => (
              <li key={it.hash} className="flex items-center justify-between gap-3 px-6 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <DirectionIcon item={it} walletLower={wallet.toLowerCase()} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{describeCategory(it)}</span>
                      <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {it.category}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                      {it.direction === "out" ? "to " : "from "}
                      {shortAddr(it.direction === "out" ? it.to : it.from)}
                      {it.timestamp ? " · " + relativeTime(it.timestamp) : ""}
                    </div>
                  </div>
                </div>
                <a
                  href={it.etherscanUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Etherscan <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="glass rounded-2xl p-4 shadow-card">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-bold text-gradient-gold">{value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function DirectionIcon({ item, walletLower }: { item: ActivityItem; walletLower: string }) {
  const isMint = item.from?.toLowerCase() === "0x0000000000000000000000000000000000000000";
  if (isMint) {
    return (
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold/15 text-gold">
        <Sparkles className="h-4 w-4" />
      </span>
    );
  }
  const isOut = item.from?.toLowerCase() === walletLower;
  return (
    <span
      className={`flex h-9 w-9 items-center justify-center rounded-full ${
        isOut ? "bg-destructive/15 text-destructive" : "bg-success/15 text-success"
      }`}
    >
      {isOut ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
    </span>
  );
}

function describeCategory(item: ActivityItem): string {
  const isMint = item.from?.toLowerCase() === "0x0000000000000000000000000000000000000000";
  if (isMint)
    return `Minted ${item.asset ?? "NFT"}${item.tokenId ? ` #${shortTokenId(item.tokenId)}` : ""}`;
  if (item.category === "erc721" || item.category === "erc1155") {
    return `${item.asset ?? "NFT"}${item.tokenId ? ` #${shortTokenId(item.tokenId)}` : ""}`;
  }
  if (item.category === "erc20" && item.asset) {
    const v = item.value;
    return `${typeof v === "number" ? v.toFixed(4) : ""} ${item.asset}`;
  }
  if (item.category === "external" && typeof item.value === "number") {
    return `${item.value.toFixed(4)} ETH`;
  }
  return "Transfer";
}

function shortTokenId(id: string) {
  if (id.length <= 8) return id;
  // Some Alchemy responses encode tokenIds as 0x-prefixed hex of 32 bytes —
  // collapse the zero padding for readability.
  if (id.startsWith("0x")) {
    const n = BigInt(id);
    return n.toString();
  }
  return id;
}

function shortAddr(addr: string) {
  if (!addr) return "—";
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function relativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function computeAnalytics(items: ActivityItem[], walletLower: string) {
  const total = items.length;
  const mints = items.filter(
    (i) => i.from?.toLowerCase() === "0x0000000000000000000000000000000000000000",
  ).length;
  const ethOut = items
    .filter(
      (i) =>
        i.category === "external" &&
        i.from?.toLowerCase() === walletLower.toLowerCase() &&
        typeof i.value === "number",
    )
    .reduce((sum, i) => sum + (i.value ?? 0), 0);

  // 90-day chart: bucket by day.
  const now = Date.now();
  const buckets = new Map<string, number>();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    buckets.set(dayKey(d), 0);
  }
  for (const it of items) {
    if (!it.timestamp) continue;
    const k = dayKey(new Date(it.timestamp));
    if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + 1);
  }
  const chart = Array.from(buckets.entries()).map(([k, count]) => ({
    label: k.slice(5), // "MM-DD"
    count,
  }));

  const last30 = chart.slice(-30).reduce((s, d) => s + d.count, 0);

  let busiestDay: string | null = null;
  let busiestDayCount = 0;
  for (const [k, c] of buckets) {
    if (c > busiestDayCount) {
      busiestDay = k;
      busiestDayCount = c;
    }
  }
  return { total, mints, ethOut, last30, chart, busiestDay, busiestDayCount };
}

function dayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Reference these to avoid "unused" warnings when the icons are only used
// by helpers above the JSX. (Not strictly needed — defensive against
// linter sweeps.)
void ImageIcon;
