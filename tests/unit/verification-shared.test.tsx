// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  VerificationStatusProvider,
  useVerificationStatus,
} from "@/lib/baycmc/useVerificationStatus";

const state = vi.hoisted(() => ({ verified: true, revalidate: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/useAuth", () => ({
  useAuth: () => ({ user: { id: "holder" }, loading: false, isAuthenticated: true }),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: () => state.revalidate }));
vi.mock("@/server/verification.functions", () => ({ revalidateOwnership: vi.fn() }));
vi.mock("@/hooks/useVerificationRevalidation", () => ({ useVerificationRevalidation: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () =>
          table === "user_roles"
            ? Promise.resolve({ data: [], error: null })
            : {
                maybeSingle: async () => ({
                  data: { bayc_verified: state.verified, bayc_collection: "BAYC" },
                  error: null,
                }),
              },
      }),
    }),
  },
}));

function Status({ name }: { name: string }) {
  const status = useVerificationStatus();
  return (
    <div data-testid={name}>
      {status.loading ? "Checking" : status.isVerifiedHolder ? "Verified" : "Not verified"}
    </div>
  );
}

describe("shared verification", () => {
  it("shows a holder without roles consistently and updates all displays after revocation", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <VerificationStatusProvider>
          <Status name="profile" />
          <Status name="menu" />
        </VerificationStatusProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("profile").textContent).toBe("Verified"));
    expect(screen.getByTestId("menu").textContent).toBe("Verified");
    expect(state.revalidate).toHaveBeenCalledTimes(1);
    state.verified = false;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["verification-status", "holder"] });
    });
    await waitFor(() => expect(screen.getByTestId("profile").textContent).toBe("Not verified"));
    expect(screen.getByTestId("menu").textContent).toBe("Not verified");
    client.clear();
  });
});
