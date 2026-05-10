/**
 * Geographic utility functions for the SPEDI map visualization.
 * Pure math — no external dependencies.
 * Formulae from: https://www.movable-type.co.uk/scripts/latlong.html
 */

const DEG = Math.PI / 180;
const R_EARTH = 6_371_000; // Earth radius in meters

/**
 * Compute the initial bearing (forward azimuth) from point 1 to point 2.
 * Returns degrees [0, 360).
 */
export function bearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const φ1 = lat1 * DEG;
    const φ2 = lat2 * DEG;
    const Δλ = (lng2 - lng1) * DEG;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);

    return ((θ / DEG) + 360) % 360;
}

/**
 * Compute the great-circle distance between two points using the Haversine formula.
 * Returns distance in meters.
 */
export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const φ1 = lat1 * DEG;
    const φ2 = lat2 * DEG;
    const Δφ = (lat2 - lat1) * DEG;
    const Δλ = (lng2 - lng1) * DEG;

    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R_EARTH * c;
}

/**
 * Linearly interpolate between two values.
 */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/**
 * Interpolate bearing using shortest-arc rotation.
 * Handles the 359° → 1° wraparound correctly.
 */
export function lerpBearing(from: number, to: number, t: number): number {
    let delta = ((to - from + 540) % 360) - 180;
    return ((from + delta * t) + 360) % 360;
}

/**
 * Compute route progress as a ratio [0, 1] based on waypoint_index.
 * Uses cumulative Haversine distance across segments.
 */
export function routeProgress(
    waypoints: Array<{ lat: number; lng: number }>,
    waypointIndex: number,
): number {
    if (!waypoints || waypoints.length < 2 || waypointIndex <= 0) return 0;

    const segmentDistances: number[] = [];
    let totalDistance = 0;

    for (let i = 1; i < waypoints.length; i++) {
        const d = haversine(
            waypoints[i - 1].lat, waypoints[i - 1].lng,
            waypoints[i].lat, waypoints[i].lng,
        );
        segmentDistances.push(d);
        totalDistance += d;
    }

    if (totalDistance === 0) return 0;

    const clampedIndex = Math.min(waypointIndex, waypoints.length - 1);
    let completedDistance = 0;
    for (let i = 0; i < clampedIndex; i++) {
        completedDistance += segmentDistances[i];
    }

    return completedDistance / totalDistance;
}
