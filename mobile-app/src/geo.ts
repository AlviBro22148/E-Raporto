import { ELBASAN_BOUNDARY } from './elbasanBoundary';

/**
 * Point-in-polygon against Bashkia Elbasan's real boundary — a client-side mirror of the backend's
 * `MunicipalityBoundaryService`, so the app can give instant feedback (no round trip) before the
 * server re-checks the same thing authoritatively on submit. Never trust this alone: the polygon
 * shipped here could be stale or the device's reported location could be tampered with — the server
 * check in `ReportsController.Create` is what actually decides.
 */
export function isInsideElbasan(lat: number, lng: number): boolean {
  let inside = false;
  const polygon = ELBASAN_BOUNDARY;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lngI] = polygon[i];
    const [latJ, lngJ] = polygon[j];
    if (lngI > lng !== lngJ > lng &&
        lat < (latJ - latI) * (lng - lngI) / (lngJ - lngI) + latI) {
      inside = !inside;
    }
  }
  return inside;
}
