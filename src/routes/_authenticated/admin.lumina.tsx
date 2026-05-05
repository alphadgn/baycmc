import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/lumina")({
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const ok = roles?.some((r) => r.role === "super_admin");
    if (!ok) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [{ title: "Admin · Lumina — BAYCMC" }],
  }),
  component: AdminLuminaPage,
});

interface LuminaGate {
  url?: string;
  contract?: string;
}

function AdminLuminaPage() {
  const [url, setUrl] = useState("");
  const [contract, setContract] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "lumina_gate")
      .maybeSingle();
    const cfg = (data?.value as LuminaGate | null) ?? null;
    setUrl(cfg?.url ?? "");
    setContract(cfg?.contract ?? "");
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSave() {
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "lumina_gate", value: { url, contract } }, { onConflict: "key" });
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success("Lumina settings saved");
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-display text-2xl font-semibold">Lumina endpoint</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure the Lumina REST endpoint used to verify BAYC ownership.
        Use <code className="font-mono">{"{wallet}"}</code> and{" "}
        <code className="font-mono">{"{contract}"}</code> as placeholders.
      </p>

      {loading ? (
        <div className="mt-6 h-32 animate-pulse rounded-lg bg-muted/20" />
      ) : (
        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold">REST URL</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.lumina.example/holders/{wallet}"
              className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold">Contract (optional)</label>
            <input
              value={contract}
              onChange={(e) => setContract(e.target.value)}
              placeholder="0x..."
              className="mt-1 w-full rounded-md border border-border bg-input px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !url}
            className="rounded-md bg-gradient-gold px-4 py-2 text-sm font-semibold text-gold-foreground shadow-gold disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      )}
    </main>
  );
}
