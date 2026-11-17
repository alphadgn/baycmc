/** Shared room-kind boundaries; regular meetings never consume karaoke state. */
export function karaokeMicLocked(kind: string, performerId: string | null, myTurn: boolean) {
  return kind === "karaoke" && !!performerId && !myTurn;
}

export function canJoinKaraokeQueue(input: {
  signedIn: boolean;
  queued: boolean;
  performing: boolean;
  bookingOnly: boolean;
  reserved: boolean;
  sanctioned: boolean;
}) {
  return input.signedIn && !input.queued && !input.performing &&
    !input.bookingOnly && !input.reserved && !input.sanctioned;
}