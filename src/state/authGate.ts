import { useVerificationStatus } from "@/lib/baycmc/useVerificationStatus";

/**
 * Single source for UI access decisions. Components MUST NOT independently
 * query ownership — read flags from here so reveal/hide logic stays
 * consistent with the server-side gates (`_verified` layout, livekit fn,
 * RLS helpers).
 */
export interface AuthGate {
  loading: boolean;
  signedIn: boolean;
  ownershipResolved: boolean;
  ownsRequiredAsset: boolean;
  showLobby: boolean;
  showConferenceRooms: boolean;
  showClubhouse: boolean;
  showPosting: boolean;
  showLifers: boolean;
  isAdmin: boolean;
}

export function useAuthGate(): AuthGate {
  const v = useVerificationStatus();
  const signedIn = !v.loading && (v.isLobby || v.isVerifiedHolder);
  return {
    loading: v.loading,
    signedIn,
    ownershipResolved: !v.loading,
    ownsRequiredAsset: v.isVerifiedHolder,
    showLobby: signedIn,
    showConferenceRooms: v.isVerifiedHolder,
    showClubhouse: v.isVerifiedHolder,
    showPosting: v.isVerifiedHolder,
    showLifers: v.isLifer,
    isAdmin: v.isAdmin,
  };
}
