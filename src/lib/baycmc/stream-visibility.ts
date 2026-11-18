/** Viewing entitlement, not a menu grant alone, controls theatre visibility. */
export function streamVisible(access: { free: boolean; hasTicket: boolean }): boolean {
  return access.free || access.hasTicket;
}
