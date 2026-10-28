import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { MemberAvatar, MemberSearchBox } from "@/components/members/MemberUi";

/**
 * Super Admin → Lifer access. Lifer access (the Cellar and Lifer Chat) is
 * granted only here, and lasts until the super admin removes it.
 */
type GrantRow = {
  user_id: string;
  created_at: string;
  username: string | null;
  avatar_url: string | null;
};

export function LiferAccessTab() {
  const [rows, setRows] = useState<GrantRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data: grants } = await supabase
      .from("lifer_grants")
      .select("user_id,created_at")
      .order("created_at", { ascending: false });
    const ids = (grants ?? []).map((g) => g.user_id);
    const { data: profs } = ids.length
      ? await supabase.rpc("member_profiles").select("id,username,avatar_url").in("id", ids)
      : { data: [] as { id: string; username: string | null; avatar_url: string | null }[] };
    setRows(
      (grants ?? []).map((g) => {
        const p = profs?.find((x) => x.id === g.user_id);
        return { ...g, username: p?.username ?? null, avatar_url: p?.avatar_url ?? null };
      }),
    );
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function setGrant(uid: string, granted: boolean, name: string) {
    setBusy(uid);
    const { error } = await supabase.rpc("set_lifer_grant", { _uid: uid, _granted: granted });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(granted ? `${name} now has Lifer access.` : `Lifer access removed for ${name}.`);
    await load();
  }

  return (
    <div className="glass max-w-2xl space-y-4 rounded-2xl p-5">
      <div>
        <h2 className="font-display text-xl text-gradient-gold">Lifer access</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Opens the Cellar and Lifer Chat. Only you can grant it, and it lasts until you remove it.
        </p>
      </div>
      <MemberSearchBox
        placeholder="Grant Lifer access — find a member by username"
        onSelect={(m) => void setGrant(m.id, true, m.username)}
      />
      {rows === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one has Lifer access yet.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {rows.map((r) => (
            <li key={r.user_id} className="flex items-center gap-3 py-2">
              <MemberAvatar
                m={{ username: r.username ?? "??", avatar_url: r.avatar_url }}
                size={32}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.username ?? "Member"}</div>
                <div className="text-[11px] text-muted-foreground">
                  Since {new Date(r.created_at).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                disabled={busy === r.user_id}
                onClick={() => void setGrant(r.user_id, false, r.username ?? "this member")}
                className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
