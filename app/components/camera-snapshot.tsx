'use client';

import { useState, useCallback } from 'react';
import { RiCamera3Line, RiImageAddLine } from '@remixicon/react';
import { useSseEvent } from './sse-context';

export function CameraSnapshot() {
    const [snapshotUri, setSnapshotUri] = useState<string | null>(null);
    const [timestamp, setTimestamp] = useState<string | null>(null);

    // Subscribe to camera snapshot events via shared SSE context
    useSseEvent('camera_snapshot', useCallback((data: any) => {
        const { dataUri, timestamp: ts } = data.payload;
        setSnapshotUri(dataUri);
        setTimestamp(ts);
    }, []));

    return (
        <div className="w-full h-full flex flex-col border border-border bg-background rounded-sm overflow-hidden aspect-video relative">
            {/* Header */}
            <div className="absolute top-0 left-0 w-full flex items-center justify-between p-3 px-4 bg-gradient-to-b from-black/80 to-transparent z-10">
                <div className="flex items-center gap-2">
                    <RiCamera3Line size={16} className="text-white" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-white font-sans drop-shadow-md">Live_Snapshot //</h3>
                </div>

                {timestamp && (
                    <div className="text-[10px] font-mono text-white/70 uppercase tracking-widest drop-shadow-md">
                        {new Date(timestamp).toLocaleTimeString()}
                    </div>
                )}
            </div>

            {/* Image display */}
            <div className="flex-1 bg-black/90 flex items-center justify-center overflow-hidden">
                {snapshotUri ? (
                    <img
                        src={snapshotUri}
                        alt="Latest Camera Snapshot"
                        className="w-full h-full object-contain"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-2 text-muted-foreground opacity-50">
                        <RiImageAddLine size={32} />
                        <span className="text-[10px] uppercase font-mono tracking-widest">Awaiting Snapshot...</span>
                    </div>
                )}
            </div>
        </div>
    );
}
