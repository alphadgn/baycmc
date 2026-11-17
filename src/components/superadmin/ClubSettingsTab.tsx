import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Save, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useClubConfiguration } from "@/components/ClubInformation";
import {
  clubConfigurationSchema,
  type ClubConfiguration,
  type ClubCollection,
} from "@/lib/club-configuration";
import { saveClubConfiguration } from "@/server/club-configuration.functions";

export function ClubSettingsTab() {
  const { data, error, isPending, refetch } = useClubConfiguration();
  const [draft, setDraft] = useState<ClubConfiguration | null>(null);
  const [saving, setSaving] = useState(false);
  const save = useServerFn(saveClubConfiguration);
  const cache = useQueryClient();
  useEffect(() => {
    if (data) setDraft((current) => current ?? structuredClone(data));
  }, [data]);
  if (error)
    return (
      <div role="alert" className="text-destructive">
        {error.message}
        <Button variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  if (isPending || !draft)
    return <Loader2 aria-label="Loading club settings" className="h-5 w-5 animate-spin" />;
  function collection(index: number, patch: Partial<ClubCollection>) {
    setDraft((d) =>
      d
        ? { ...d, collections: d.collections.map((c, i) => (i === index ? { ...c, ...patch } : c)) }
        : d,
    );
  }
  async function submit() {
    if (!draft) return;
    const parsed = clubConfigurationSchema.safeParse(draft);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Check your settings");
      return;
    }
    setSaving(true);
    try {
      await save({ data: parsed.data });
      cache.setQueryData(["club-configuration"], parsed.data);
      await cache.invalidateQueries();
      toast.success("Club settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save settings");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between gap-3">
        <h2 className="font-display text-2xl">Club settings</h2>
        <Button disabled={saving} onClick={() => void submit()}>
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </header>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-gold">Allowed collections</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setDraft({
                ...draft,
                collections: [
                  ...draft.collections,
                  {
                    label: "",
                    name: "",
                    contract: "",
                    chainId: 1,
                    access: "partner",
                    active: false,
                    tips: false,
                  },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" />
            Add collection
          </Button>
        </div>
        {draft.collections.map((c, i) => (
          <div
            key={i}
            className="grid gap-3 border-b border-border py-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <label className="text-xs text-muted-foreground">
              Collection name
              <Input
                aria-label={`Collection name ${i + 1}`}
                value={c.name}
                onChange={(e) => collection(i, { name: e.target.value })}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Label
              <Input
                aria-label={`Collection label ${i + 1}`}
                value={c.label}
                onChange={(e) => collection(i, { label: e.target.value.toUpperCase() })}
              />
            </label>
            <label className="text-xs text-muted-foreground sm:col-span-2">
              Contract
              <Input
                aria-label={`Collection contract ${i + 1}`}
                className="font-mono text-xs"
                value={c.contract}
                onChange={(e) => collection(i, { contract: e.target.value })}
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Chain
              <select
                aria-label={`Collection chain ${i + 1}`}
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-2 text-foreground"
                value={c.chainId}
                onChange={(e) =>
                  collection(i, { chainId: Number(e.target.value) as ClubCollection["chainId"] })
                }
              >
                <option value={1}>Ethereum</option>
                <option value={33139}>ApeChain</option>
                <option value={4663}>Robinhood</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Access tier
              <select
                aria-label={`Collection access ${i + 1}`}
                className="mt-1 h-9 w-full rounded-md border border-border bg-input px-2 text-foreground"
                value={c.access}
                onChange={(e) =>
                  collection(i, { access: e.target.value as ClubCollection["access"] })
                }
              >
                <option value="full">Full holder</option>
                <option value="partner">Partner</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label={`Enable ${c.name || "collection"}`}
                checked={c.active}
                onCheckedChange={(active) => collection(i, { active })}
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                aria-label={`Tips for ${c.name || "collection"}`}
                checked={c.tips}
                onCheckedChange={(tips) => collection(i, { tips })}
              />
              Tips
            </label>
          </div>
        ))}
      </section>
      <section>
        <h3 className="mb-3 font-display text-lg text-gold">Club rules</h3>
        <Textarea
          aria-label="Club rules"
          rows={6}
          value={draft.rules}
          onChange={(e) => setDraft({ ...draft, rules: e.target.value })}
        />
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg text-gold">Social links</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setDraft({ ...draft, socialLinks: [...draft.socialLinks, { label: "", url: "" }] })
            }
          >
            <Plus className="h-4 w-4" />
            Add link
          </Button>
        </div>
        {draft.socialLinks.map((link, i) => (
          <div key={i} className="flex flex-wrap gap-2">
            <Input
              aria-label={`Social link name ${i + 1}`}
              className="w-full sm:w-40"
              value={link.label}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  socialLinks: draft.socialLinks.map((l, n) =>
                    n === i ? { ...l, label: e.target.value } : l,
                  ),
                })
              }
            />
            <Input
              aria-label={`Social link URL ${i + 1}`}
              className="min-w-0 flex-1"
              value={link.url}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  socialLinks: draft.socialLinks.map((l, n) =>
                    n === i ? { ...l, url: e.target.value } : l,
                  ),
                })
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove social link ${i + 1}`}
              onClick={() =>
                setDraft({ ...draft, socialLinks: draft.socialLinks.filter((_, n) => n !== i) })
              }
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}
