import { getToken } from './auth-store';

/**
 * Helper to dynamically resolve the API base URL.
 * If NEXT_PUBLIC_API_URL points to localhost/127.0.0.1, but the user is accessing the dashboard
 * via a network IP (e.g., from a mobile phone testing the system), this rewrites the API URL
 * to point to that network IP. Otherwise, remote devices would try to connect to their own loopback.
 */
function resolveApiUrl(): string {
    const defaultUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001';

    if (typeof window !== 'undefined' && (defaultUrl.includes('127.0.0.1') || defaultUrl.includes('localhost'))) {
        const host = window.location.hostname;
        if (host !== '127.0.0.1' && host !== 'localhost') {
            return defaultUrl.replace(/127\.0\.0\.1|localhost/, host);
        }
    }
    return defaultUrl;
}

/**
 * Centralised fetch helper that:
 *  1. Prepends the correct backend URL (Railway in prod, localhost in dev, or network IP for testers).
 *  2. Attaches the in-memory JWT as a Bearer token.
 *
 * Usage:  const res = await apiFetch('/devices');
 */
export async function apiFetch(
    path: string,
    options: RequestInit = {},
): Promise<Response> {
    const token = getToken();
    const headers: Record<string, string> = {
        ...(options.headers as Record<string, string>),
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }

    return fetch(`${resolveApiUrl()}${path}`, { ...options, headers });
}

/** The raw backend base URL — used for SSE/WebSocket where apiFetch can't be used. */
export function getApiUrl(): string {
    return resolveApiUrl();
}

/**
 * Returns a WebSocket-compatible base URL derived from the API URL.
 * http://... → ws://...
 * https://... → wss://...
 */
export function getWsUrl(): string {
    return resolveApiUrl().replace(/^http/, 'ws');
}
