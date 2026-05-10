import { describe, it, expect } from 'vitest';
import { bearing, haversine, lerp, lerpBearing, routeProgress } from '../../lib/geo-utils';

describe('bearing()', () => {
    it('should return ~0° for due north', () => {
        const b = bearing(0, 0, 1, 0);
        expect(b).toBeCloseTo(0, 0);
    });

    it('should return ~90° for due east', () => {
        const b = bearing(0, 0, 0, 1);
        expect(b).toBeCloseTo(90, 0);
    });

    it('should return ~180° for due south', () => {
        const b = bearing(1, 0, 0, 0);
        expect(b).toBeCloseTo(180, 0);
    });

    it('should return ~270° for due west', () => {
        const b = bearing(0, 0, 0, -1);
        expect(b).toBeCloseTo(270, 0);
    });

    it('should return 0 for identical points', () => {
        const b = bearing(13.75, 100.5, 13.75, 100.5);
        expect(b).toBe(0);
    });

    it('should compute Bangkok → Pattaya bearing (~135° SE)', () => {
        // Bangkok: 13.7563, 100.5018; Pattaya: 12.9236, 100.8825
        const b = bearing(13.7563, 100.5018, 12.9236, 100.8825);
        expect(b).toBeGreaterThan(130);
        expect(b).toBeLessThan(160);
    });
});

describe('haversine()', () => {
    it('should return 0 for identical points', () => {
        expect(haversine(0, 0, 0, 0)).toBe(0);
    });

    it('should compute 1° longitude at equator ≈ 111 km', () => {
        const d = haversine(0, 0, 0, 1);
        const km = d / 1000;
        expect(km).toBeGreaterThan(110);
        expect(km).toBeLessThan(113);
    });

    it('should compute Bangkok → Pattaya ≈ 147 km', () => {
        const d = haversine(13.7563, 100.5018, 12.9236, 100.8825);
        const km = d / 1000;
        expect(km).toBeGreaterThan(90);
        expect(km).toBeLessThan(110);
    });

    it('should handle antipodal points ≈ 20,000 km', () => {
        const d = haversine(0, 0, 0, 180);
        const km = d / 1000;
        expect(km).toBeCloseTo(20_015, -2);
    });
});

describe('lerp()', () => {
    it('should return a at t=0', () => {
        expect(lerp(10, 20, 0)).toBe(10);
    });

    it('should return b at t=1', () => {
        expect(lerp(10, 20, 1)).toBe(20);
    });

    it('should return midpoint at t=0.5', () => {
        expect(lerp(0, 100, 0.5)).toBe(50);
    });
});

describe('lerpBearing()', () => {
    it('should handle normal interpolation', () => {
        expect(lerpBearing(0, 90, 0.5)).toBeCloseTo(45, 1);
    });

    it('should handle wraparound 350° → 10°', () => {
        const result = lerpBearing(350, 10, 0.5);
        expect(result).toBeCloseTo(0, 0);
    });

    it('should handle wraparound 10° → 350°', () => {
        const result = lerpBearing(10, 350, 0.5);
        expect(result).toBeCloseTo(0, 0);
    });
});

describe('routeProgress()', () => {
    const waypoints = [
        { lat: 0, lng: 0 },
        { lat: 0, lng: 1 },  // ~111 km
        { lat: 0, lng: 2 },  // another ~111 km
        { lat: 0, lng: 3 },  // another ~111 km
    ];

    it('should return 0 for index 0', () => {
        expect(routeProgress(waypoints, 0)).toBe(0);
    });

    it('should return ~0.33 for index 1 (1 of 3 segments)', () => {
        const p = routeProgress(waypoints, 1);
        expect(p).toBeCloseTo(1 / 3, 1);
    });

    it('should return ~0.67 for index 2 (2 of 3 segments)', () => {
        const p = routeProgress(waypoints, 2);
        expect(p).toBeCloseTo(2 / 3, 1);
    });

    it('should return 1 for last index', () => {
        const p = routeProgress(waypoints, 3);
        expect(p).toBeCloseTo(1, 1);
    });

    it('should handle null/empty waypoints', () => {
        expect(routeProgress([], 0)).toBe(0);
        expect(routeProgress(null as any, 0)).toBe(0);
    });

    it('should clamp index beyond waypoints length', () => {
        const p = routeProgress(waypoints, 100);
        expect(p).toBeCloseTo(1, 1);
    });
});
