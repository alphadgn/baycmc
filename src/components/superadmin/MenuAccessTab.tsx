import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2 } from "lucide-react";
import { getMenuMatrix, setMenuItem } from "@/server/menu-access.functions";
import { MENU_ITEMS } from "@/lib/baycmc/menu-items";

/**
 * Check sheet: which menu areas each allowlisted collection unlocks.
 * A tick both SHOWS the menu item and GRANTS access to that area
 * (enforced in the database, the route guard and the LiveKit gate).
 */
export function MenuAccessTab() {
  const fetchMatrix = useServerFn(getMenuMatrix);
  const save = useServerFn(setMenuItem);
  const [collections, setCollections] = useState<{ label: string; name: string; access: string }[]>(
    [],
  );
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchMatrix();
      setCollections(res.collections);
      setEnabled(
        new Set(
          res.rows.filter((r) => r.enabled).map((r) => `${r.collection_label}|${r.item_key}`),
        ),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load menu access");
    } finally {
      setLoading(false);
    }
  }, [fetchMatrix]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(collection: string, item: string) {
    const key = `${collection}|${item}`;
    const next = !enabled.has(key);
    setBusy(key);
    setEnabled((prev) => {
      const s = new Set(prev);
      if (next) s.add(key);
      else s.delete(key);
      return s;
    });
    try {
      await save({ data: { collection, item, enabled: next } });
      window.dispatchEvent(new Event("baycmc:menu-access-changed"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save");
      void load();
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const k of enabled) {
      const c = k.split("|")[0]!;
      m[c] = (m[c] ?? 0) + 1;
    }
    return m;
  }, [enabled]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </p>
    );
  }

  return (
    <section className="glass rounded-2xl p-4 shadow-card sm:p-6">
      <h2 className="font-display text-2xl">Menu access by collection</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Tick what each verified collection's holders see in the menu — and can open. Public Lobby,
        Karaoke, Profile and Support are always available. Admins see everything. Changes apply
        immediately.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 bg-card/95 p-2 text-left font-semibold text-muted-foreground">
                Collection
              </th>
              {MENU_ITEMS.map((i) => (
                <th key={i.key} className="p-2 text-center font-semibold text-gold">
                  {i.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {collections.map((c) => (
              <tr key={c.label} className="border-t border-border/50">
                <td className="sticky left-0 border-t border-border/40 bg-card/95 p-2">
                  <span className="font-semibold">{c.name}</span>
                  <span className="ml-1 text-[10px] text-muted-foreground">
                    · {counts[c.label] ?? 0} on
                  </span>
                </td>
                {MENU_ITEMS.map((i) => {
                  const key = `${c.label}|${i.key}`;
                  const on = enabled.has(key);
                  return (
                    <td key={i.key} className="border-t border-border/40 p-2 text-center">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`${c.name}: ${i.label}`}
                        disabled={busy === key}
                        onClick={() => void toggle(c.label, i.key)}
                        className={`inline-flex h-6 w-6 items-center justify-center rounded border transition ${
                          on
                            ? "border-gold bg-gold text-gold-foreground"
                            : "border-border bg-transparent hover:border-gold/60"
                        } disabled:opacity-50`}
                      >
                        {on && <Check className="h-4 w-4" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
