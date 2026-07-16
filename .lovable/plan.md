## Goal
Make it obvious where to link `0xD796…33C0` (or any wallet) by surfacing Linked Wallets directly on the Profile page, matching what I told you earlier.

## Change
Add the existing `LinkedWalletsPanel` component to `src/routes/_authenticated/profile.tsx`, right below the `VerificationStatusPanel`. No new logic — the panel already handles:
- Adding a wallet address
- Sign-to-verify with that wallet
- Listing verified linked wallets
- Removing wallets

This means once you land on **Profile**, you'll see the panel, paste `0xD796bd30280ac676A1a2f01b3C0279F786ED33C0`, sign from that wallet, and the delegate.xyz walk will pick up BAYC #2931 on the next `/lobby` or verified-route visit.

## Files
- `src/routes/_authenticated/profile.tsx` — import `LinkedWalletsPanel` and render it in the sidebar/section next to verification status.

## Not doing
- No changes to `LinkedWalletsPanel` itself.
- No change to the resolver / delegate.xyz logic — it already handles this case correctly once the wallet is verified.
- Leaving the panel on `/verify` in place too, so both paths work.

## How to use once shipped
Profile → Linked Wallets → **Add wallet** → paste `0xD796…33C0` → **Sign** in whatever wallet controls that address → refresh `/lobby`.