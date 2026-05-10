import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock sseService in isolation ─────────────────────────────────────
// We test the SseService and LogService classes directly without needing
// a real Fastify server. The mock reply objects simulate Node raw HTTP response.

function createMockReply() {
    const chunks: string[] = [];
    const raw = {
        writeHead: vi.fn(),
        write: vi.fn((data: string) => { chunks.push(data); return true; }),
        end: vi.fn(),
        on: vi.fn(),
    };
    return { raw, chunks };
}

// We need to import after mocking environment
// Inline the SseService class behavior for unit testing
describe('SseService', () => {
    // Re-create a fresh SseService for each test to avoid singleton state leaking
    let SseService: any;
    let sseService: any;

    beforeEach(async () => {
        // Dynamic import to get fresh module each time
        vi.resetModules();
        // Mock the Fastify types we don't need
        const mod = await import('../services/sse.service');
        // Create a new instance (bypass singleton)
        SseService = (mod as any).SseService || mod;
        // We'll test via the exported singleton for simplicity
        sseService = mod.sseService;
        // Clear any existing clients from previous tests
        (sseService as any).clients.clear();
    });

    it('should broadcast correctly formatted SSE frames to all clients', () => {
        const reply1 = createMockReply();
        const reply2 = createMockReply();

        sseService.addClient('client-1', reply1 as any);
        sseService.addClient('client-2', reply2 as any);

        sseService.broadcast({
            type: 'telemetry',
            deviceId: 'device-1',
            payload: { lat: 13.75, lng: 100.5 },
        });

        // Each client should have received 2 writes: initial heartbeat + the broadcast
        // The broadcast message should be properly formatted SSE
        const msg1 = reply1.chunks.find((c: string) => c.includes('event: telemetry'));
        const msg2 = reply2.chunks.find((c: string) => c.includes('event: telemetry'));

        expect(msg1).toBeDefined();
        expect(msg2).toBeDefined();
        expect(msg1).toContain('event: telemetry\n');
        expect(msg1).toContain('"lat":13.75');
        expect(msg1).toContain('"deviceId":"device-1"');
    });

    it('should be a no-op when broadcasting to zero clients', () => {
        // Should not throw
        expect(() => {
            sseService.broadcast({
                type: 'syslog',
                payload: { message: 'test' },
            });
        }).not.toThrow();
    });

    it('should remove dead clients on broadcast failure', () => {
        let callCount = 0;
        const failReply = {
            raw: {
                writeHead: vi.fn(),
                // First call succeeds (addClient heartbeat), subsequent calls throw
                write: vi.fn(() => {
                    callCount++;
                    if (callCount > 1) throw new Error('Connection reset');
                    return true;
                }),
                end: vi.fn(),
                on: vi.fn(),
            },
        };

        sseService.addClient('dead-client', failReply as any);
        expect((sseService as any).clients.size).toBe(1);

        // Broadcast should catch the error and remove the dead client
        sseService.broadcast({
            type: 'syslog',
            payload: { message: 'test' },
        });

        expect((sseService as any).clients.size).toBe(0);
    });

    it('should send to a specific client', () => {
        const reply = createMockReply();
        sseService.addClient('specific-client', reply as any);

        sseService.sendToClient('specific-client', {
            type: 'session_change',
            deviceId: 'device-1',
            payload: { sessionId: 'sess-123', userId: 'user-1' },
        });

        const msg = reply.chunks.find((c: string) => c.includes('event: session_change'));
        expect(msg).toBeDefined();
        expect(msg).toContain('"sessionId":"sess-123"');
    });

    it('should clean up heartbeat interval on closeAll', () => {
        const reply = createMockReply();
        sseService.addClient('client-1', reply as any);

        sseService.closeAll();

        expect((sseService as any).clients.size).toBe(0);
        expect(reply.raw.end).toHaveBeenCalled();
    });
});

describe('LogService', () => {
    let logService: any;
    let sseService: any;

    beforeEach(async () => {
        vi.resetModules();

        // Mock the sse.service module so logService doesn't need real connections
        vi.doMock('../services/sse.service', () => {
            const broadcastFn = vi.fn();
            return {
                sseService: {
                    broadcast: broadcastFn,
                    addClient: vi.fn(),
                    sendToClient: vi.fn(),
                    closeAll: vi.fn(),
                },
            };
        });

        const logMod = await import('../services/log.service');
        logService = logMod.logService;

        const sseMod = await import('../services/sse.service');
        sseService = sseMod.sseService;
    });

    it('should create log entries with UUID and correct structure', () => {
        logService.info('system', 'connection', 'Server started');

        const logs = logService.getRecentLogs();
        expect(logs).toHaveLength(1);
        expect(logs[0].id).toBeDefined();
        expect(logs[0].id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
        expect(logs[0].source).toBe('system');
        expect(logs[0].level).toBe('info');
        expect(logs[0].type).toBe('connection');
        expect(logs[0].message).toBe('Server started');
        expect(logs[0].timestamp).toBeDefined();
    });

    it('should broadcast syslog events via SSE on every log', () => {
        logService.info('arduino', 'telemetry', 'Device connected');

        expect(sseService.broadcast).toHaveBeenCalledWith({
            type: 'syslog',
            payload: expect.objectContaining({
                source: 'arduino',
                level: 'info',
                type: 'telemetry',
                message: 'Device connected',
            }),
        });
    });

    it('should respect MAX_LOGS circular buffer limit', () => {
        const MAX = 200;
        for (let i = 0; i < MAX + 50; i++) {
            logService.info('system', 'connection', `Log entry ${i}`);
        }

        const logs = logService.getRecentLogs();
        expect(logs.length).toBe(MAX);
        // Newest should be first
        expect(logs[0].message).toBe(`Log entry ${MAX + 49}`);
    });

    it('should return logs in newest-first order', () => {
        logService.info('system', 'connection', 'First');
        logService.warn('system', 'connection', 'Second');
        logService.error('system', 'connection', 'Third');

        const logs = logService.getRecentLogs();
        expect(logs[0].message).toBe('Third');
        expect(logs[1].message).toBe('Second');
        expect(logs[2].message).toBe('First');
    });

    it('should support all log levels', () => {
        logService.info('system', 'connection', 'info msg');
        logService.warn('system', 'connection', 'warn msg');
        logService.error('system', 'connection', 'error msg');

        const logs = logService.getRecentLogs();
        expect(logs.map((l: any) => l.level)).toEqual(['error', 'warn', 'info']);
    });
});
