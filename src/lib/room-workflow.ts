/** Shared room-kind boundaries; regular meetings never consume karaoke state. */
export function karaokeMicLocked(kind: string, performerId: string | null, myTurn: boolean) {
  return kind === "karaoke" && !!performerId && !myTurn;
}

export function canJoinKaraokeQueue(input: {
  signedIn: boolean;
  queued: boolean;
  performing: boolean;
  bookingOnly: boolean;
  sanctioned: boolean;
}) {
  return input.signedIn && !input.queued && !input.performing &&
    !input.bookingOnly && !input.sanctioned;
}

export function conferenceAdmission(input: { booked: boolean; ownsBooking: boolean; staff: boolean; guestStatus?: string }) {
  if (!input.booked || input.ownsBooking || input.staff || input.guestStatus === "approved") return "admitted";
  return input.guestStatus === "denied" ? "denied" : "waiting";
}