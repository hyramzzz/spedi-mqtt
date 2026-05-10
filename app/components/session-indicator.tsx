'use client';

import { useState, useEffect, useCallback } from 'react';
import { RiUser3Line, RiTimeLine, RiRadioButtonLine } from "@remixicon/react";
import { apiFetch } from '@/lib/api';
import { useSseEvent } from './sse-context';

interface ActiveSession {
    sessionId: string;
    userId: string;
    deviceId: string;
    connectedAt: string;
}

export function SessionIndicator() {
    const [session, setSession] = useState<ActiveSession | null>(null);

    // Fetch initial session state on mount
    useEffect(() => {
        const fetchSession = async () => {
            try {
                const res = await apiFetch('/session');
                if (res.ok) {
                    const data = await res.json();
                    setSession(data);
                }
            } catch (err) {
                console.error('Failed to fetch initial session', err);
            }
        };
        fetchSession();
    }, []);

    // Subscribe to session change events via shared SSE context
    useSseEvent('session_change', useCallback((data: any) => {
        setSession(data.payload);
    }, []));

    if (!session) {
        return (
            <div className="flex items-center gap-2 px-2 py-1 rounded-sm border bg-muted text-muted-foreground text-[10px] font-mono uppercase tracking-widest leading-none">
                <RiRadioButtonLine size={12} />
                Idle
            </div>
        );
    }

    return (
        <div className="flex items-center gap-3 px-2 py-1 rounded-sm border bg-foreground text-background text-[10px] font-mono uppercase tracking-widest leading-none animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center gap-1.5 font-bold">
                <RiRadioButtonLine size={12} className="animate-pulse" />
                <span>LINK_ESTABLISHED</span>
            </div>
            <div className="h-3 w-px bg-background/30" />
            <div className="flex items-center gap-1.5 opacity-90">
                <RiUser3Line size={12} />
                <span>{session.userId.slice(0, 8)}...</span>
            </div>
            <div className="h-3 w-px bg-background/30" />
            <div className="flex items-center gap-1.5 opacity-90">
                <RiTimeLine size={12} />
                <span>{new Date(session.connectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
        </div>
    );
}
