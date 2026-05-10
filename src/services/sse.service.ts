import { FastifyRequest, FastifyReply } from 'fastify';

export interface SseEvent {
    type: 'telemetry' | 'session_change' | 'device_online' | 'device_offline' | 'syslog' | 'camera_snapshot';
    deviceId?: string;
    payload: Record<string, any> | any;
}

class SseService {
    // Map of active SSE connections, keyed by a unique connection ID
    private clients: Map<string, FastifyReply> = new Map();
    private heartbeatInterval: NodeJS.Timeout | null = null;
    private readonly HEARTBEAT_MS = 30_000;

    constructor() {
        this.startHeartbeat();
    }

    /**
     * Sends SSE comment lines to all clients every 30s.
     * Prevents Railway/Vercel proxies and browsers from timing out idle connections.
     */
    private startHeartbeat(): void {
        this.heartbeatInterval = setInterval(() => {
            for (const [id, reply] of this.clients.entries()) {
                try {
                    reply.raw.write(':\n\n');
                } catch {
                    this.clients.delete(id);
                }
            }
        }, this.HEARTBEAT_MS);
    }

    /**
     * Registers a new SSE client connection.
     * Keeps the connection open and handles formatting messages as SSE.
     */
    addClient(id: string, reply: FastifyReply) {
        // Preserve any existing headers (like CORS injected by Fastify plugins)
        const existingHeaders = reply.getHeaders ? reply.getHeaders() : {};

        // Set standard SSE headers
        reply.raw.writeHead(200, {
            ...existingHeaders,
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });

        // Send an initial heartbeat to confirm connection
        reply.raw.write(':\n\n');

        this.clients.set(id, reply);

        // Handle client disconnect
        reply.raw.on('close', () => {
            this.clients.delete(id);
        });
    }

    /**
     * Broadcasts an event to all connected SSE clients.
     * The dashboard is a global observer, so it receives events for all devices.
     */
    broadcast(event: SseEvent) {
        if (this.clients.size === 0) return;

        const dataString = JSON.stringify({
            deviceId: event.deviceId,
            payload: event.payload
        });

        // SSE format:
        // event: [type]\n
        // data: [json]\n\n
        const message = `event: ${event.type}\ndata: ${dataString}\n\n`;

        for (const [id, reply] of this.clients.entries()) {
            try {
                reply.raw.write(message);
            } catch (err) {
                console.error(`Failed to broadcast to SSE client ${id}:`, err);
                this.clients.delete(id);
            }
        }
    }

    /**
     * Send an event to a specific client (e.g. initial state flush on connect)
     */
    sendToClient(id: string, event: SseEvent) {
        const reply = this.clients.get(id);
        if (!reply) return;

        const dataString = JSON.stringify({
            deviceId: event.deviceId,
            payload: event.payload
        });

        const message = `event: ${event.type}\ndata: ${dataString}\n\n`;
        try {
            reply.raw.write(message);
        } catch (err) {
            console.error(`Failed to send to SSE client ${id}:`, err);
            this.clients.delete(id);
        }
    }

    /**
     * Closes all active SSE connections (useful for graceful shutdown)
     */
    closeAll() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        for (const [id, reply] of this.clients.entries()) {
            reply.raw.end();
            this.clients.delete(id);
        }
    }
}

export const sseService = new SseService();
