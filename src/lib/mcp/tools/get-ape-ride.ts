import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { dbError, jsonResult, supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_ape_ride",
  title: "Get Ape Rides stream detail",
  description: "Return details for a single Ape Rides stream, including its current viewer requests.",
  inputSchema: {
    ride_id: z.string().uuid(),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ ride_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const [rideRes, requestsRes, locRes] = await Promise.all([
      supabase.from("ape_rides").select("*").eq("id", ride_id).maybeSingle(),
      supabase
        .from("ape_ride_requests")
        .select("id,viewer_id,status,message,created_at")
        .eq("ride_id", ride_id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.from("ape_ride_locations").select("*").eq("ride_id", ride_id).maybeSingle(),
    ]);
    if (rideRes.error) return dbError(rideRes.error.message);
    if (!rideRes.data) {
      return {
        content: [{ type: "text", text: "Ride not found or not visible." }],
        isError: true,
      };
    }
    return jsonResult({
      ride: rideRes.data,
      requests: requestsRes.data ?? [],
      location: locRes.data ?? null,
    });
  },
});
