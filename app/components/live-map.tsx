'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { RiFullscreenLine, RiFullscreenExitLine, RiMapPinLine } from '@remixicon/react';
import { useSseEvent } from './sse-context';
import { apiFetch } from '@/lib/api';
import { bearing, lerp, lerpBearing, routeProgress, haversine } from '@/lib/geo-utils';
import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';

// Operating region fallback — Gulf of Thailand (last resort only)
const REGION_DEFAULT: [number, number] = [100.5, 13.75];
const TELEMETRY_INTERVAL = 2000; // ms between pulses
const LS_KEY = 'spedi_last_pos';

/** Read last known position from localStorage (synchronous, instant). */
function getStoredPosition(): [number, number] | null {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const { lng, lat } = JSON.parse(raw);
        if (typeof lng === 'number' && typeof lat === 'number' && (lng !== 0 || lat !== 0)) {
            return [lng, lat];
        }
    } catch { /* corrupted — ignore */ }
    return null;
}

/** Persist position to localStorage on every telemetry tick. */
function storePosition(lng: number, lat: number) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({ lng, lat }));
    } catch { /* quota — ignore */ }
}

/**
 * LiveMap — real-time boat position tracker and route visualizer.
 *
 * Pure SSE consumer: subscribes to 'telemetry' events and renders
 * smooth position interpolation, heading indicator, GPS trail,
 * and route progress — all in-memory, zero API calls per tick.
 */
export function LiveMap({ isVisible = true }: { isVisible?: boolean }) {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapRef = useRef<MaplibreMap | null>(null);
    const rafRef = useRef<number>(0);
    const [isExpanded, setIsExpanded] = useState(false);
    const [mapLoaded, setMapLoaded] = useState(false);

    // Resolve initial center: localStorage > region default
    const initialCenter = useRef<[number, number]>(getStoredPosition() ?? REGION_DEFAULT);

    // Interpolation state (refs for rAF access without re-renders)
    const prevPos = useRef<{ lat: number; lng: number }>({ lat: initialCenter.current[1], lng: initialCenter.current[0] });
    const nextPos = useRef<{ lat: number; lng: number }>({ lat: initialCenter.current[1], lng: initialCenter.current[0] });
    const prevBearing = useRef(0);
    const nextBearing = useRef(0);
    const lastPulseTime = useRef(0);
    const hasReceivedTelemetry = useRef(false);

    // Trail buffer — accumulates during session/mission, clears on mode→idle
    const trailCoords = useRef<Array<[number, number]>>([]);
    const lastMode = useRef<string | null>(null);

    // Route state
    const routeWaypoints = useRef<Array<{ lat: number; lng: number }> | null>(null);
    const currentWaypointIndex = useRef(0);

    // ── Initialize MapLibre ──────────────────────────────────────
    useEffect(() => {
        let map: MaplibreMap;
        let cancelled = false;

        (async () => {
            // Dynamic import — MapLibre needs `window`
            const maplibregl = (await import('maplibre-gl')).default;

            if (cancelled || !mapContainerRef.current) return;

            map = new maplibregl.Map({
                container: mapContainerRef.current,
                style: '/map-style-dark.json',
                center: initialCenter.current,
                zoom: 15,
                attributionControl: false,
            });

            map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');
            map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');
            map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

            mapRef.current = map;

            map.on('load', () => {
                if (cancelled) return;

                // ── Boat position source + layer ───────────────
                map.addSource('boat-position', {
                    type: 'geojson',
                    data: { type: 'Feature', geometry: { type: 'Point', coordinates: initialCenter.current }, properties: {} },
                });

                map.addLayer({
                    id: 'boat-pulse',
                    type: 'circle',
                    source: 'boat-position',
                    paint: {
                        'circle-radius': 14,
                        'circle-color': 'rgba(255,255,255,0.08)',
                        'circle-stroke-width': 0,
                    },
                });

                map.addLayer({
                    id: 'boat-marker',
                    type: 'circle',
                    source: 'boat-position',
                    paint: {
                        'circle-radius': 5,
                        'circle-color': '#f0f0f0',
                        'circle-stroke-width': 2,
                        'circle-stroke-color': 'rgba(255,255,255,0.4)',
                    },
                });

                // ── Travel trail source + layer ────────────────
                map.addSource('travel-trail', {
                    type: 'geojson',
                    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
                });

                map.addLayer({
                    id: 'travel-trail-layer',
                    type: 'line',
                    source: 'travel-trail',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': 'rgba(240,240,240,0.35)',
                        'line-width': 2,
                    },
                });

                // ── Route line source + layers ─────────────────
                map.addSource('route-line', {
                    type: 'geojson',
                    data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} },
                });

                map.addLayer({
                    id: 'route-line-bg',
                    type: 'line',
                    source: 'route-line',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': 'rgba(255,255,255,0.08)',
                        'line-width': 4,
                    },
                });

                map.addLayer({
                    id: 'route-line-layer',
                    type: 'line',
                    source: 'route-line',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: {
                        'line-color': 'rgba(255,255,255,0.5)',
                        'line-width': 2,
                    },
                });

                // Route waypoint dots
                map.addSource('route-waypoints', {
                    type: 'geojson',
                    data: { type: 'FeatureCollection', features: [] },
                });

                map.addLayer({
                    id: 'route-waypoints-layer',
                    type: 'circle',
                    source: 'route-waypoints',
                    paint: {
                        'circle-radius': 3,
                        'circle-color': 'rgba(255,255,255,0.25)',
                        'circle-stroke-width': 1,
                        'circle-stroke-color': 'rgba(255,255,255,0.15)',
                    },
                });

                // Move trail + route below boat marker
                map.moveLayer('travel-trail-layer', 'boat-pulse');
                map.moveLayer('route-line-bg', 'travel-trail-layer');
                map.moveLayer('route-line-layer', 'travel-trail-layer');
                map.moveLayer('route-waypoints-layer', 'travel-trail-layer');

                setMapLoaded(true);

                // Start rAF loop
                startAnimationLoop();
            });
        })();

        return () => {
            cancelled = true;
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            if (map) map.remove();
            mapRef.current = null;
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Fetch initial shadow for route on mount ──────────────────
    useEffect(() => {
        if (!mapLoaded) return;

        (async () => {
            try {
                // Try to load device state for route visualization
                const devRes = await apiFetch('/devices');
                if (!devRes.ok) return;
                const devices = await devRes.json();
                if (!devices || devices.length === 0) return;

                const stateRes = await apiFetch(`/devices/${devices[0].id}/state`);
                if (!stateRes.ok) return;
                const state = await stateRes.json();

                if (state.desired?.route && state.desired.route.length >= 2) {
                    routeWaypoints.current = state.desired.route;
                    updateRouteOnMap(state.desired.route);
                }

                // If reported has position, use it as initial center
                if (state.reported?.lat && state.reported?.lng) {
                    const lat = Number(state.reported.lat);
                    const lng = Number(state.reported.lng);
                    if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
                        prevPos.current = { lat, lng };
                        nextPos.current = { lat, lng };
                        mapRef.current?.flyTo({ center: [lng, lat], duration: 1000 });
                    }
                }
            } catch {
                // Silently fail — map works without initial state
            }
        })();
    }, [mapLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── rAF interpolation loop ───────────────────────────────────
    const startAnimationLoop = useCallback(() => {
        const animate = () => {
            const map = mapRef.current;
            if (!map || !hasReceivedTelemetry.current) {
                rafRef.current = requestAnimationFrame(animate);
                return;
            }

            const elapsed = Date.now() - lastPulseTime.current;
            const v = Math.min(elapsed / TELEMETRY_INTERVAL, 1);

            const interpLat = lerp(prevPos.current.lat, nextPos.current.lat, v);
            const interpLng = lerp(prevPos.current.lng, nextPos.current.lng, v);
            const interpBearing = lerpBearing(prevBearing.current, nextBearing.current, v);

            // Update boat position
            const src = map.getSource('boat-position') as GeoJSONSource | undefined;
            if (src) {
                src.setData({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [interpLng, interpLat] },
                    properties: { bearing: interpBearing },
                });
            }

            rafRef.current = requestAnimationFrame(animate);
        };

        rafRef.current = requestAnimationFrame(animate);
    }, []);

    // ── SSE telemetry handler ────────────────────────────────────
    useSseEvent('telemetry', useCallback((data: any) => {
        const payload = data.payload;
        if (!payload) return;

        const lat = Number(payload.lat);
        const lng = Number(payload.lng);
        if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return;

        const now = Date.now();

        if (hasReceivedTelemetry.current) {
            // Compute bearing from prev fix to new fix
            const elapsed = now - lastPulseTime.current;
            const v = Math.min(elapsed / TELEMETRY_INTERVAL, 1);

            // Snap prev to current interpolated position (no jump)
            prevPos.current = {
                lat: lerp(prevPos.current.lat, nextPos.current.lat, v),
                lng: lerp(prevPos.current.lng, nextPos.current.lng, v),
            };

            const newBearing = bearing(prevPos.current.lat, prevPos.current.lng, lat, lng);
            const dist = haversine(prevPos.current.lat, prevPos.current.lng, lat, lng);

            // Only update bearing if the boat moved > 1m (noise filter)
            if (dist > 1) {
                prevBearing.current = lerpBearing(prevBearing.current, nextBearing.current, v);
                nextBearing.current = newBearing;
            }
        } else {
            // First telemetry — initialize position
            prevPos.current = { lat, lng };
            prevBearing.current = 0;
            nextBearing.current = 0;

            // Center map on first real position
            mapRef.current?.flyTo({ center: [lng, lat], zoom: 16, duration: 1500 });
        }

        nextPos.current = { lat, lng };
        lastPulseTime.current = now;
        hasReceivedTelemetry.current = true;

        // Persist to localStorage on every tick
        storePosition(lng, lat);

        // ── Trail clearing on mode→idle ──────────────────────
        const currentMode = payload.mode ?? null;
        if (lastMode.current && lastMode.current !== 'idle' && currentMode === 'idle') {
            // Session or mission just ended — clear the trail
            trailCoords.current = [];
            const map = mapRef.current;
            if (map) {
                const trailSrc = map.getSource('travel-trail') as GeoJSONSource | undefined;
                if (trailSrc) {
                    trailSrc.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
                }
                // Also clear route progress visualization
                const routeSrc = map.getSource('route-line') as GeoJSONSource | undefined;
                if (routeSrc) {
                    routeSrc.setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} });
                }
                const wpSrc = map.getSource('route-waypoints') as GeoJSONSource | undefined;
                if (wpSrc) {
                    wpSrc.setData({ type: 'FeatureCollection', features: [] });
                }
                routeWaypoints.current = null;
                currentWaypointIndex.current = 0;
            }
        }
        lastMode.current = currentMode;

        // Add to trail (accumulates during active session/mission, no rolling cap)
        if (currentMode && currentMode !== 'idle') {
            trailCoords.current.push([lng, lat]);

            // Update trail on map
            const map = mapRef.current;
            if (map) {
                const trailSrc = map.getSource('travel-trail') as GeoJSONSource | undefined;
                if (trailSrc && trailCoords.current.length >= 2) {
                    trailSrc.setData({
                        type: 'Feature',
                        geometry: { type: 'LineString', coordinates: trailCoords.current },
                        properties: {},
                    });
                }
            }
        }

        // Update waypoint index for route progress
        if (payload.waypoint_index !== undefined && payload.waypoint_index !== null) {
            currentWaypointIndex.current = Number(payload.waypoint_index);
            updateRouteProgress();
        }
    }, []));

    // ── Route visualization helpers ──────────────────────────────
    const updateRouteOnMap = useCallback((waypoints: Array<{ lat: number; lng: number }>) => {
        const map = mapRef.current;
        if (!map) return;

        const coords = waypoints.map(wp => [wp.lng, wp.lat] as [number, number]);

        const routeSrc = map.getSource('route-line') as GeoJSONSource | undefined;
        if (routeSrc) {
            routeSrc.setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: {},
            });
        }

        const wpSrc = map.getSource('route-waypoints') as GeoJSONSource | undefined;
        if (wpSrc) {
            wpSrc.setData({
                type: 'FeatureCollection',
                features: waypoints.map((wp, i) => ({
                    type: 'Feature' as const,
                    geometry: { type: 'Point' as const, coordinates: [wp.lng, wp.lat] },
                    properties: { index: i },
                })),
            });
        }
    }, []);

    const updateRouteProgress = useCallback(() => {
        const map = mapRef.current;
        const waypoints = routeWaypoints.current;
        if (!map || !waypoints || waypoints.length < 2) return;

        const progress = routeProgress(waypoints, currentWaypointIndex.current);

        // Color completed portion brighter, remaining dimmer
        // Using line-gradient requires lineMetrics on the source
        // For simplicity, we adjust the overall line opacity based on progress indication
        // A full line-gradient implementation requires recreating the source with lineMetrics: true
        // For now, we use a simpler visual: completed segments in full opacity
        const completedCoords = waypoints
            .slice(0, currentWaypointIndex.current + 1)
            .map(wp => [wp.lng, wp.lat] as [number, number]);

        const routeBgSrc = map.getSource('route-line') as GeoJSONSource | undefined;
        if (routeBgSrc) {
            routeBgSrc.setData({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: waypoints.map(wp => [wp.lng, wp.lat]),
                },
                properties: {},
            });
        }

        // Update the progress line to show only completed segments
        if (completedCoords.length >= 2) {
            const routeProgressSrc = map.getSource('route-line') as GeoJSONSource | undefined;
            // We'll indicate progress by adjusting the line layer paint
            map.setPaintProperty('route-line-layer', 'line-opacity', 0.3 + progress * 0.5);
        }
    }, []);

    // Listen for route changes via session_change SSE
    useSseEvent('session_change', useCallback((data: any) => {
        // When session changes, re-fetch device state for updated route
        if (data.payload?.route) {
            routeWaypoints.current = data.payload.route;
            updateRouteOnMap(data.payload.route);
        }
    }, [updateRouteOnMap]));

    // ── Fullscreen toggle ────────────────────────────────────────
    const toggleExpand = useCallback(() => {
        setIsExpanded(prev => !prev);
    }, []);

    // Handle resize when expanded state changes
    useEffect(() => {
        const map = mapRef.current;
        if (map) {
            // Delay resize to allow CSS transition to complete
            const timer = setTimeout(() => map.resize(), 50);
            return () => clearTimeout(timer);
        }
    }, [isExpanded]);

    // Handle resize when tab visibility changes
    useEffect(() => {
        if (isVisible && mapRef.current) {
            const timer = setTimeout(() => mapRef.current?.resize(), 50);
            return () => clearTimeout(timer);
        }
    }, [isVisible]);

    // Handle Escape key to close fullscreen
    useEffect(() => {
        if (!isExpanded) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsExpanded(false);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isExpanded]);

    // ── Render ───────────────────────────────────────────────────
    const containerClass = isExpanded
        ? 'fixed inset-0 z-50 bg-background flex flex-col'
        : 'w-full h-full flex flex-col';

    return (
        <div className={containerClass}>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-3 px-4 bg-muted/30 shrink-0 z-10">
                <div className="flex items-center gap-2">
                    <RiMapPinLine size={16} className="text-foreground" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-foreground font-sans">Nav_View //</h3>
                </div>

                <div className="flex items-center gap-2">
                    {!hasReceivedTelemetry.current && (
                        <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                            AWAITING_FIX
                        </span>
                    )}
                    <button
                        onClick={toggleExpand}
                        className="flex items-center gap-1.5 px-2 py-1 bg-background border border-border text-foreground rounded-sm hover:border-foreground transition-colors text-[10px] font-mono uppercase tracking-widest"
                        title={isExpanded ? 'Collapse Map' : 'Expand Map'}
                    >
                        {isExpanded ? <RiFullscreenExitLine size={12} /> : <RiFullscreenLine size={12} />}
                        {isExpanded ? 'COLLAPSE' : 'EXPAND'}
                    </button>
                </div>
            </div>

            {/* Map Container */}
            <div
                ref={mapContainerRef}
                className="flex-1 w-full"
                style={{ minHeight: isExpanded ? undefined : '300px' }}
            />
        </div>
    );
}
