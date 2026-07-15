import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import listRoomsTool from "./tools/list-rooms";
import listRoomBookingsTool from "./tools/list-room-bookings";
import bookRoomTool from "./tools/book-room";
import listKaraokeSessionsTool from "./tools/list-karaoke-sessions";
import getKaraokeQueueTool from "./tools/get-karaoke-queue";
import listKaraokeRecordingsTool from "./tools/list-karaoke-recordings";
import listApeRidesTool from "./tools/list-ape-rides";
import getApeRideTool from "./tools/get-ape-ride";
import getVerificationStatusTool from "./tools/get-verification-status";
import listLinkedWalletsTool from "./tools/list-linked-wallets";

// Direct Supabase host — the .lovable.cloud proxy is rejected by RFC 8414
// issuer-match on the discovery document. The project ref is the only
// Supabase value that survives publish unchanged.
const projectRef =
  import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "baycmc-mcp",
  title: "BAYCMC MCP",
  version: "0.2.0",
  instructions:
    "Tools for the BAYCMC clubhouse app. Read and manage conference rooms, karaoke sessions and recordings, Ape Rides streams, verification, and linked wallets — always as the signed-in BAYCMC user under RLS. Use `echo` to verify connectivity.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    echoTool,
    listRoomsTool,
    listRoomBookingsTool,
    bookRoomTool,
    listKaraokeSessionsTool,
    getKaraokeQueueTool,
    listKaraokeRecordingsTool,
    listApeRidesTool,
    getApeRideTool,
    getVerificationStatusTool,
    listLinkedWalletsTool,
  ],
});
