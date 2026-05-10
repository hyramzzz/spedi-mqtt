'use client';

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getApiUrl } from '@/lib/api';
import { getToken } from '@/lib/auth-store';

type SseEventHandler = (data: any) => void;

interface SseContextValue {
    /** Subscribe to a specific SSE event type. Returns an unsubscribe function. */
    subscribe: (eventType: string, handler: SseEventHandler) => () => void;
    /** Current connection state */
    connectionState: 'connecting' | 'connected' | 'disconnected';
    /** Manually reconnect the SSE connection */
    reconnect: () => void;
}

const SseContext = createContext<SseContextValue | null>(null);

/**
 * SseProvider — owns the single EventSource connection for the entire dashboard.
 * 
 * Must be mounted AFTER auth verification completes (inside DashboardLayout)
 * so that getToken() is guaranteed to return a valid JWT.
 * 
 * All child components subscribe to specific event types via useSseEvent().
 * One connection, shared by TelemetryPanel, SystemActivity, SessionIndicator, etc.
 */
export function SseProvider({ children }: { children: React.ReactNode }) {
    const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
    const eventSourceRef = useRef<EventSource | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Registry of event handlers: Map<eventType, Set<handler>>
    const handlersRef = useRef<Map<string, Set<SseEventHandler>>>(new Map());

    // Track which SSE event listeners are attached, so we can clean up
    const attachedTypesRef = useRef<Set<string>>(new Set());

    const connectSSE = useCallback(() => {
        // Clean up existing
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }

        // Reset attached listeners tracking since this is a new EventSource instance
        attachedTypesRef.current.clear();

        const token = getToken();
        if (!token) {
            setConnectionState('disconnected');
            return;
        }

        setConnectionState('connecting');
        const sse = new EventSource(`${getApiUrl()}/events?token=${token}`);
        eventSourceRef.current = sse;

        sse.onopen = () => {
            setConnectionState('connected');
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
        };

        // Attach listeners for all currently subscribed event types
        for (const eventType of handlersRef.current.keys()) {
            attachEventListener(sse, eventType);
        }

        sse.onerror = () => {
            setConnectionState('disconnected');
            sse.close();
            eventSourceRef.current = null;

            // Reconnect with 5s backoff
            if (!reconnectTimeoutRef.current) {
                reconnectTimeoutRef.current = setTimeout(() => {
                    reconnectTimeoutRef.current = null;
                    connectSSE();
                }, 5000);
            }
        };
    }, []);

    /** Attach a native addEventListener for a given event type on the EventSource */
    const attachEventListener = useCallback((sse: EventSource, eventType: string) => {
        if (attachedTypesRef.current.has(eventType)) return;

        sse.addEventListener(eventType, (e: MessageEvent) => {
            const handlers = handlersRef.current.get(eventType);
            if (!handlers || handlers.size === 0) return;

            try {
                const data = JSON.parse(e.data);
                for (const handler of handlers) {
                    handler(data);
                }
            } catch (err) {
                console.error(`Failed to parse SSE event '${eventType}':`, err);
            }
        });

        attachedTypesRef.current.add(eventType);
    }, []);

    /** Subscribe to a specific SSE event type. Returns unsubscribe function. */
    const subscribe = useCallback((eventType: string, handler: SseEventHandler): (() => void) => {
        // Add to registry
        if (!handlersRef.current.has(eventType)) {
            handlersRef.current.set(eventType, new Set());
        }
        handlersRef.current.get(eventType)!.add(handler);

        // If SSE is already connected, attach listener for this new type
        if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
            attachEventListener(eventSourceRef.current, eventType);
        }

        // Return unsubscribe
        return () => {
            const handlers = handlersRef.current.get(eventType);
            if (handlers) {
                handlers.delete(handler);
                if (handlers.size === 0) {
                    handlersRef.current.delete(eventType);
                }
            }
        };
    }, [attachEventListener]);

    // Connect on mount
    useEffect(() => {
        connectSSE();

        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
                reconnectTimeoutRef.current = null;
            }
            attachedTypesRef.current.clear();
        };
    }, [connectSSE]);

    return (
        <SseContext.Provider value={{ subscribe, connectionState, reconnect: connectSSE }}>
            {children}
        </SseContext.Provider>
    );
}

/**
 * Hook to subscribe to a specific SSE event type.
 * The handler is called with the parsed JSON data for each event of that type.
 * 
 * Usage:
 *   useSseEvent('syslog', (data) => { ... });
 *   useSseEvent('telemetry', (data) => { ... });
 */
export function useSseEvent(eventType: string, handler: SseEventHandler) {
    const ctx = useContext(SseContext);
    const handlerRef = useRef(handler);
    handlerRef.current = handler;

    useEffect(() => {
        if (!ctx) return;

        const stableHandler: SseEventHandler = (data) => {
            handlerRef.current(data);
        };

        return ctx.subscribe(eventType, stableHandler);
    }, [ctx, eventType]);
}

/**
 * Hook to read the current SSE connection state.
 */
export function useSseConnectionState(): 'connecting' | 'connected' | 'disconnected' {
    const ctx = useContext(SseContext);
    return ctx?.connectionState ?? 'disconnected';
}

/**
 * Hook to manually trigger an SSE stream reconnect.
 * Useful for fetching initial state if it becomes desynced.
 */
export function useSseReconnect(): (() => void) | undefined {
    const ctx = useContext(SseContext);
    return ctx?.reconnect;
}
