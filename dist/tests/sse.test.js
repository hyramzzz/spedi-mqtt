"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// ── Mock sseService in isolation ─────────────────────────────────────
// We test the SseService and LogService classes directly without needing
// a real Fastify server. The mock reply objects simulate Node raw HTTP response.
function createMockReply() {
    const chunks = [];
    const raw = {
        writeHead: vitest_1.vi.fn(),
        write: vitest_1.vi.fn((data) => { chunks.push(data); return true; }),
        end: vitest_1.vi.fn(),
        on: vitest_1.vi.fn(),
    };
    return { raw, chunks };
}
// We need to import after mocking environment
// Inline the SseService class behavior for unit testing
(0, vitest_1.describe)('SseService', () => {
    // Re-create a fresh SseService for each test to avoid singleton state leaking
    let SseService;
    let sseService;
    (0, vitest_1.beforeEach)(async () => {
        // Dynamic import to get fresh module each time
        vitest_1.vi.resetModules();
        // Mock the Fastify types we don't need
        const mod = await import('../services/sse.service');
        // Create a new instance (bypass singleton)
        SseService = mod.SseService || mod;
        // We'll test via the exported singleton for simplicity
        sseService = mod.sseService;
        // Clear any existing clients from previous tests
        sseService.clients.clear();
    });
    (0, vitest_1.it)('should broadcast correctly formatted SSE frames to all clients', () => {
        const reply1 = createMockReply();
        const reply2 = createMockReply();
        sseService.addClient('client-1', reply1);
        sseService.addClient('client-2', reply2);
        sseService.broadcast({
            type: 'telemetry',
            deviceId: 'device-1',
            payload: { lat: 13.75, lng: 100.5 },
        });
        // Each client should have received 2 writes: initial heartbeat + the broadcast
        // The broadcast message should be properly formatted SSE
        const msg1 = reply1.chunks.find((c) => c.includes('event: telemetry'));
        const msg2 = reply2.chunks.find((c) => c.includes('event: telemetry'));
        (0, vitest_1.expect)(msg1).toBeDefined();
        (0, vitest_1.expect)(msg2).toBeDefined();
        (0, vitest_1.expect)(msg1).toContain('event: telemetry\n');
        (0, vitest_1.expect)(msg1).toContain('"lat":13.75');
        (0, vitest_1.expect)(msg1).toContain('"deviceId":"device-1"');
    });
    (0, vitest_1.it)('should be a no-op when broadcasting to zero clients', () => {
        // Should not throw
        (0, vitest_1.expect)(() => {
            sseService.broadcast({
                type: 'syslog',
                payload: { message: 'test' },
            });
        }).not.toThrow();
    });
    (0, vitest_1.it)('should remove dead clients on broadcast failure', () => {
        let callCount = 0;
        const failReply = {
            raw: {
                writeHead: vitest_1.vi.fn(),
                // First call succeeds (addClient heartbeat), subsequent calls throw
                write: vitest_1.vi.fn(() => {
                    callCount++;
                    if (callCount > 1)
                        throw new Error('Connection reset');
                    return true;
                }),
                end: vitest_1.vi.fn(),
                on: vitest_1.vi.fn(),
            },
        };
        sseService.addClient('dead-client', failReply);
        (0, vitest_1.expect)(sseService.clients.size).toBe(1);
        // Broadcast should catch the error and remove the dead client
        sseService.broadcast({
            type: 'syslog',
            payload: { message: 'test' },
        });
        (0, vitest_1.expect)(sseService.clients.size).toBe(0);
    });
    (0, vitest_1.it)('should send to a specific client', () => {
        const reply = createMockReply();
        sseService.addClient('specific-client', reply);
        sseService.sendToClient('specific-client', {
            type: 'session_change',
            deviceId: 'device-1',
            payload: { sessionId: 'sess-123', userId: 'user-1' },
        });
        const msg = reply.chunks.find((c) => c.includes('event: session_change'));
        (0, vitest_1.expect)(msg).toBeDefined();
        (0, vitest_1.expect)(msg).toContain('"sessionId":"sess-123"');
    });
    (0, vitest_1.it)('should clean up heartbeat interval on closeAll', () => {
        const reply = createMockReply();
        sseService.addClient('client-1', reply);
        sseService.closeAll();
        (0, vitest_1.expect)(sseService.clients.size).toBe(0);
        (0, vitest_1.expect)(reply.raw.end).toHaveBeenCalled();
    });
});
(0, vitest_1.describe)('LogService', () => {
    let logService;
    let sseService;
    (0, vitest_1.beforeEach)(async () => {
        vitest_1.vi.resetModules();
        // Mock the sse.service module so logService doesn't need real connections
        vitest_1.vi.doMock('../services/sse.service', () => {
            const broadcastFn = vitest_1.vi.fn();
            return {
                sseService: {
                    broadcast: broadcastFn,
                    addClient: vitest_1.vi.fn(),
                    sendToClient: vitest_1.vi.fn(),
                    closeAll: vitest_1.vi.fn(),
                },
            };
        });
        const logMod = await import('../services/log.service');
        logService = logMod.logService;
        const sseMod = await import('../services/sse.service');
        sseService = sseMod.sseService;
    });
    (0, vitest_1.it)('should create log entries with UUID and correct structure', () => {
        logService.info('system', 'connection', 'Server started');
        const logs = logService.getRecentLogs();
        (0, vitest_1.expect)(logs).toHaveLength(1);
        (0, vitest_1.expect)(logs[0].id).toBeDefined();
        (0, vitest_1.expect)(logs[0].id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
        (0, vitest_1.expect)(logs[0].source).toBe('system');
        (0, vitest_1.expect)(logs[0].level).toBe('info');
        (0, vitest_1.expect)(logs[0].type).toBe('connection');
        (0, vitest_1.expect)(logs[0].message).toBe('Server started');
        (0, vitest_1.expect)(logs[0].timestamp).toBeDefined();
    });
    (0, vitest_1.it)('should broadcast syslog events via SSE on every log', () => {
        logService.info('arduino', 'telemetry', 'Device connected');
        (0, vitest_1.expect)(sseService.broadcast).toHaveBeenCalledWith({
            type: 'syslog',
            payload: vitest_1.expect.objectContaining({
                source: 'arduino',
                level: 'info',
                type: 'telemetry',
                message: 'Device connected',
            }),
        });
    });
    (0, vitest_1.it)('should respect MAX_LOGS circular buffer limit', () => {
        const MAX = 200;
        for (let i = 0; i < MAX + 50; i++) {
            logService.info('system', 'connection', `Log entry ${i}`);
        }
        const logs = logService.getRecentLogs();
        (0, vitest_1.expect)(logs.length).toBe(MAX);
        // Newest should be first
        (0, vitest_1.expect)(logs[0].message).toBe(`Log entry ${MAX + 49}`);
    });
    (0, vitest_1.it)('should return logs in newest-first order', () => {
        logService.info('system', 'connection', 'First');
        logService.warn('system', 'connection', 'Second');
        logService.error('system', 'connection', 'Third');
        const logs = logService.getRecentLogs();
        (0, vitest_1.expect)(logs[0].message).toBe('Third');
        (0, vitest_1.expect)(logs[1].message).toBe('Second');
        (0, vitest_1.expect)(logs[2].message).toBe('First');
    });
    (0, vitest_1.it)('should support all log levels', () => {
        logService.info('system', 'connection', 'info msg');
        logService.warn('system', 'connection', 'warn msg');
        logService.error('system', 'connection', 'error msg');
        const logs = logService.getRecentLogs();
        (0, vitest_1.expect)(logs.map((l) => l.level)).toEqual(['error', 'warn', 'info']);
    });
});
