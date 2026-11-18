# Collection room visibility

The live rules were read, not modified. They allowed Event Stream discovery from the collection menu alone even when media entry required a paid ticket. Room-specific collection checks also combined a menu grant from one collection with a room holding from another.

Prepared code hides Event Stream without existing free-view or current-ticket entitlement in the shared navigation, conference list and direct route. Entitlement errors fail closed. Server-filtered room discovery, media entry, occupancy and MCP listing share the room visibility check. Existing staff, verified-role (BAYC/MAYC), public karaoke/game, chapter, Mudwater and Lifer grant behavior is preserved. Ticket purchase/payment APIs and event listings are unchanged; the theatre no longer acts as a purchase landing screen.

## Database review

`20261118_collection_room_visibility.sql` is unapplied. It makes existing rooms SELECT and room-chat policies enforce the same paid-stream and same-collection rules. Apply only after approval; until then raw database room discovery and room-chat visibility retain the old rules, while updated app discovery and media entry enforce the new checks. No publishing or shared database mutation was performed.

## Verification limits

Focused authorization tests cover paid versus free viewing, cross-collection rejection, staff/public exceptions, Lifer grants and failed checks (18 passed across four suites; nine pre-existing isolated database tests skipped). Compiler reported build OK; changed-code lint passed. Shared live collection configuration was read only. A browser session was minted for the requesting account, but restoring it did not sign the UI in; signed-in navigation is therefore unverified. Physical-device media and accounts for every collection are not available for full end-to-end verification.