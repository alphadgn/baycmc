import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Local type wrapper for the beta supabase.auth.oauth namespace.
type OAuthClientInfo = { name?: string | null } | null | undefined;
type OAuthAuthorizationDetails = {
  client?: OAuthClientInfo;
  redirect_url?: string | null;
  redirect_to?: string | null;
  scope?: string | null;
  scopes?: string[] | null;
} | null;

type AuthOAuth = {
  getAuthorizationDetails: (
    id: string
  ) => Promise<{ data: OAuthAuthorizationDetails; error: { message: string } | null }>;
  approveAuthorization: (
    id: string
  ) => Promise<{
    data: { redirect_url?: string | null; redirect_to?: string | null } | null;
    error: { message: string } | null;
  }>;
  denyAuthorization: (
    id: string
  ) => Promise<{
    data: { redirect_url?: string | null; redirect_to?: string | null } | null;
    error: { message: string } | null;
  }>;
};

function oauth(): AuthOAuth {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabase.auth as any).oauth as AuthOAuth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id:
      typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) {
      throw new Error("Missing authorization_id");
    }
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) {
      throw redirect({ to: "/login", search: { next } });
    }
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get(
      "authorization_id"
    )!;
    const { data, error } = await oauth().getAuthorizationDetails(
      authorizationId
    );
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) {
      throw redirect({ href: immediate });
    }
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold">Authorization error</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientName = details?.client?.name ?? "an external app";
  const scopes =
    details?.scopes ??
    (details?.scope ? details.scope.split(/\s+/).filter(Boolean) : []);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect URL returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-12">
      <div className="glass rounded-2xl border border-gold/20 p-6 shadow-card sm:p-8">
        <h1 className="font-display text-2xl font-bold">
          Connect {clientName} to BAYCMC
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This lets {clientName} use BAYCMC's enabled tools while you are
          signed in. It does not bypass BAYCMC's permissions or backend
          policies.
        </p>

        {scopes.length > 0 && (
          <div className="mt-4 rounded-md border border-border bg-secondary/30 p-3 text-sm">
            <p className="font-medium text-foreground">Requested access</p>
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {scopes.map((s: string) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-4 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex gap-3">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 rounded-md bg-gold px-4 py-2 text-sm font-semibold text-background disabled:opacity-50"
          >
            {busy ? "Working…" : "Approve"}
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 rounded-md border border-border bg-secondary/30 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Cancel connection
          </button>
        </div>
      </div>
    </main>
  );
}
