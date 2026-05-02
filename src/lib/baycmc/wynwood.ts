// Wynwood Arts District geofence — center near 25th St & NW 2nd Ave, Miami
export const WYNWOOD_CENTER = { lat: 25.8010, lng: -80.1990 } as const;
export const WYNWOOD_RADIUS_METERS = 1000;

export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function isInsideWynwood(loc: { lat: number; lng: number }): boolean {
  return haversineMeters(loc, WYNWOOD_CENTER) <= WYNWOOD_RADIUS_METERS;
}
