import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLocalChapters, type LocalChapter } from "@/lib/chapters/chapters";

/**
 * Super Admin → Local chapters. The chapter names shown in the Local
 * Chapters menu: add, rename, reorder, hide or remove (removing deletes that
 * chapter's meetings and their chats).
 */
export function LocalChaptersTab() {
  const chapters = useLocalChapters(true);
  type Draft = { name: string; region: string; x: string };
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (chapters)
      setDraft(
        Object.fromEntries(
          chapters.map((c) => [c.id, { name: c.name, region: c.region ?? "", x: c.x_url ?? "" }]),
        ),
      );
  }, [chapters]);

  const changed = () => window.dispatchEvent(new Event("baycmc:chapters-changed"));

  async function save(c: LocalChapter | null, patch: Partial<LocalChapter> & { name: string }) {
    const key = c?.id ?? "new";
    setBusy(key);
    const { error } = await supabase.rpc("chapter_save", {
      _id: c?.id ?? null,
      _name: patch.name,
      _order: patch.display_order ?? c?.display_order ?? (chapters?.length ?? 0) + 1,
      _active: patch.active ?? c?.active ?? true,
      // Always send region / X link so a rename or toggle never clears them.
      _region: patch.region !== undefined ? patch.region : (c?.region ?? null),
      _x_url: patch.x_url !== undefined ? patch.x_url : (c?.x_url ?? null),
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    if (!c) setNewName("");
    changed();
  }

  async function move(i: number, dir: -1 | 1) {
    if (!chapters) return;
    const a = chapters[i];
    const b = chapters[i + dir];
    if (!a || !b) return;
    setBusy(a.id);
    const r1 = await supabase.rpc("chapter_save", {
      _id: a.id,
      _name: a.name,
      _order: b.display_order,
      _active: a.active,
      _region: a.region,
      _x_url: a.x_url,
    });
    const r2 = await supabase.rpc("chapter_save", {
      _id: b.id,
      _name: b.name,
      _order: a.display_order === b.display_order ? a.display_order + dir : a.display_order,
      _active: b.active,
      _region: b.region,
      _x_url: b.x_url,
    });
    setBusy(null);
    if (r1.error || r2.error) toast.error((r1.error ?? r2.error)!.message);
    changed();
  }

  async function remove(c: LocalChapter) {
    if (
      !window.confirm(
        `Remove "${c.name}"? Its meetings and their chats are deleted too. To keep them, hide the chapter instead.`,
      )
    )
      return;
    setBusy(c.id);
    const { error } = await supabase.rpc("chapter_remove", { _id: c.id });
    setBusy(null);
    if (error) return toast.error(error.message);
    changed();
  }

  return (
    <div className="glass space-y-4 rounded-2xl p-4 shadow-card">
      <div>
        <h2 className="font-semibold">Local chapters</h2>
        <p className="text-xs text-muted-foreground">
          The official BAYC local clubs. These names appear under Local Chapters in the menu for
          verified BAYC, MAYC and CryptoPunks holders. Hidden chapters stay in the list here but
          aren't shown or bookable.
        </p>
      </div>
      {chapters === null ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted/20" />
      ) : (
        <ul className="space-y-2">
          {chapters.map((c, i) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/40 p-2"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0 || !!busy}
                  onClick={() => void move(i, -1)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === chapters.length - 1 || !!busy}
                  onClick={() => void move(i, 1)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                aria-label="Chapter name"
                className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm"
                maxLength={60}
                value={draft[c.id]?.name ?? c.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [c.id]: { ...d[c.id], name: e.target.value } }))
                }
              />
              <input
                aria-label="Region"
                placeholder="Region"
                className="min-h-10 w-full rounded-md border border-border bg-input px-3 py-2 text-xs sm:w-40"
                maxLength={80}
                value={draft[c.id]?.region ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [c.id]: { ...d[c.id], region: e.target.value } }))
                }
              />
              <input
                aria-label="X link"
                placeholder="https://x.com/…"
                inputMode="url"
                className="min-h-10 w-full rounded-md border border-border bg-input px-3 py-2 text-xs sm:w-56"
                value={draft[c.id]?.x ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [c.id]: { ...d[c.id], x: e.target.value } }))
                }
              />
              <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={c.active}
                  disabled={!!busy}
                  onChange={(e) => void save(c, { name: c.name, active: e.target.checked })}
                />
                Shown
              </label>
              <button
                type="button"
                disabled={
                  !!busy ||
                  !draft[c.id]?.name.trim() ||
                  (draft[c.id].name === c.name &&
                    draft[c.id].region === (c.region ?? "") &&
                    draft[c.id].x === (c.x_url ?? ""))
                }
                onClick={() =>
                  void save(c, {
                    name: draft[c.id].name.trim(),
                    region: draft[c.id].region.trim() || null,
                    x_url: draft[c.id].x.trim() || null,
                  })
                }
                className="inline-flex min-h-10 items-center gap-1 rounded-md border border-gold/50 px-3 py-2 text-xs text-gold disabled:opacity-40"
              >
                {busy === c.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </button>
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                disabled={!!busy}
                onClick={() => void remove(c)}
                className="inline-flex min-h-10 items-center rounded-md border border-border px-2 py-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) void save(null, { name: newName.trim() });
        }}
      >
        <input
          className="min-h-10 min-w-0 flex-1 rounded-md border border-border bg-input px-3 py-2 text-sm"
          placeholder="New chapter name (e.g. Midwest Apes)"
          maxLength={60}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button
          type="submit"
          disabled={!newName.trim() || !!busy}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md bg-gradient-gold px-3 py-2 text-xs font-semibold text-gold-foreground disabled:opacity-50"
        >
          {busy === "new" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Add
        </button>
      </form>
    </div>
  );
}
