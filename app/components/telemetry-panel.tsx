'use client';

import { useState, useCallback } from 'react';
import {
    RiMapPinLine,
    RiRadarLine,
    RiSteering2Line,
    RiCarLine,
    RiWifiOffLine,
    RiRefreshLine
} from "@remixicon/react";
import { useSseEvent, useSseConnectionState, useSseReconnect } from './sse-context';

interface TelemetryData {
    mode: string | null;
    lat: number | null;
    lng: number | null;
    obstacle_left: number | null;
    obstacle_right: number | null;
    smart_move_active: boolean | null;
    waypoint_index: number | null;
}

export function TelemetryPanel() {
    const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
    const [deviceStatus, setDeviceStatus] = useState<'online' | 'offline' | 'unknown'>('unknown');
    const connectionState = useSseConnectionState();
    const reconnect = useSseReconnect();

    // Subscribe to telemetry events via shared SSE context
    useSseEvent('telemetry', useCallback((data: any) => {
        setTelemetry(data.payload);
    }, []));

    useSseEvent('device_online', useCallback(() => {
        setDeviceStatus('online');
    }, []));

    useSseEvent('device_offline', useCallback(() => {
        setDeviceStatus('offline');
        setTelemetry(null); // Clear telemetry visually when device dies
    }, []));

    // Format helpers
    const formatValue = (val: number | string | boolean | null | undefined, suffix = '') => {
        if (val === null || val === undefined) return '--';
        if (typeof val === 'number') return `${val.toFixed(notInt(val) ? 4 : 0)}${suffix}`;
        if (typeof val === 'boolean') return val ? 'Active' : 'Inactive';
        return val.toString();
    };

    const notInt = (n: number) => n % 1 !== 0;

    return (
        <div className="w-full flex flex-col border border-border bg-background rounded-sm">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-3 px-4 bg-muted/30">
                <div className="flex items-center gap-3">
                    <div className={`h-2 w-2 rounded-sm ${deviceStatus === 'online' ? 'bg-foreground animate-pulse' :
                        deviceStatus === 'offline' ? 'bg-foreground/30' : 'bg-muted-foreground'
                        }`} />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-foreground font-sans">Telemetry_Stream</h3>
                </div>

                <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest">
                    {connectionState === 'connecting' && (
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <RiRefreshLine size={12} className="animate-spin" />
                            Establishing...
                        </span>
                    )}
                    {connectionState === 'disconnected' && (
                        <span className="flex items-center gap-1.5 text-foreground">
                            <RiWifiOffLine size={12} />
                            Offline
                        </span>
                    )}
                    {connectionState === 'connected' && (
                        <span className="text-foreground flex items-center gap-1.5 font-bold">
                            SSE_ACTIVE
                        </span>
                    )}

                    <button
                        onClick={reconnect}
                        className="flex items-center gap-1.5 px-2 py-1 ml-2 bg-background border border-border text-foreground rounded-sm hover:border-foreground transition-colors disabled:opacity-50"
                        title="Force Refresh Telemetry"
                        disabled={connectionState === 'connecting'}
                    >
                        <RiRefreshLine size={12} className={connectionState === 'connecting' ? 'animate-spin' : ''} />
                        REFRESH
                    </button>
                </div>
            </div>

            {/* Dashboard Grid */}
            <div className="bg-border grid grid-cols-2 lg:grid-cols-4 gap-px">
                {/* GPS */}
                <div className="bg-background p-4 flex flex-col gap-1 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-foreground">
                        <RiMapPinLine size={80} />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans">Position</span>
                    <div className="flex items-baseline gap-1 mt-3 font-mono">
                        <span className="text-xl text-foreground font-medium">{formatValue(telemetry?.lat)}</span>
                        <span className="text-muted-foreground text-xs">LAT</span>
                    </div>
                    <div className="flex items-baseline gap-1 font-mono">
                        <span className="text-xl text-foreground font-medium">{formatValue(telemetry?.lng)}</span>
                        <span className="text-muted-foreground text-xs">LNG</span>
                    </div>
                </div>

                {/* Sonar */}
                <div className="bg-background p-4 flex flex-col gap-1 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-foreground">
                        <RiRadarLine size={80} />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans">Obstacle Sensors</span>
                    <div className="flex items-baseline gap-2 mt-3">
                        <span className="text-muted-foreground text-[10px] font-mono w-4">L</span>
                        <span className="text-xl text-foreground font-medium font-mono">{formatValue(telemetry?.obstacle_left, 'cm')}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-muted-foreground text-[10px] font-mono w-4">R</span>
                        <span className="text-xl text-foreground font-medium font-mono">{formatValue(telemetry?.obstacle_right, 'cm')}</span>
                    </div>
                </div>

                {/* Mode */}
                <div className="bg-background p-4 flex flex-col gap-1 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-foreground">
                        <RiSteering2Line size={80} />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans">Vehicle Mode</span>
                    <div className="mt-3 text-2xl font-mono uppercase font-bold text-foreground">
                        {telemetry?.mode || 'Unknown'}
                    </div>
                    <div className="mt-auto pt-2 text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                        Wpt Index: <span className="text-foreground">{formatValue(telemetry?.waypoint_index)}</span>
                    </div>
                </div>

                {/* Smart Move */}
                <div className="bg-background p-4 flex flex-col gap-1 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-foreground">
                        <RiCarLine size={80} />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans">Smart Move</span>
                    <div className="mt-3 flex items-center gap-2">
                        <div className={`h-2 w-2 rounded-sm border ${telemetry?.smart_move_active ? 'bg-foreground border-foreground animate-pulse' : 'bg-transparent border-muted-foreground'}`} />
                        <span className={`text-xl font-mono font-bold uppercase ${telemetry?.smart_move_active ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {formatValue(telemetry?.smart_move_active)}
                        </span>
                    </div>
                    <p className="mt-auto pt-2 text-[10px] text-muted-foreground leading-tight font-sans uppercase">
                        Override active upon detection
                    </p>
                </div>
            </div>
        </div>
    );
}
