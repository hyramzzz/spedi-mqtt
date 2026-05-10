"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
(0, vitest_1.describe)('SessionService — Lifecycle', () => {
    let sessionService;
    let deviceService;
    (0, vitest_1.beforeEach)(async () => {
        vitest_1.vi.resetModules();
        // Mock logService
        vitest_1.vi.doMock('../services/log.service', () => ({
            logService: {
                info: vitest_1.vi.fn(),
                warn: vitest_1.vi.fn(),
                error: vitest_1.vi.fn(),
                log: vitest_1.vi.fn(),
                getRecentLogs: vitest_1.vi.fn(() => []),
            },
        }));
        // Mock configService
        vitest_1.vi.doMock('../services/config.service', () => ({
            configService: {
                get: vitest_1.vi.fn(() => null),
                load: vitest_1.vi.fn(),
            },
        }));
        // Mock supabase with working insert/update/select chains
        const mockInsert = vitest_1.vi.fn(() => ({
            select: vitest_1.vi.fn(() => ({
                single: vitest_1.vi.fn(() => ({
                    data: { id: 'session-uuid-123' },
                    error: null,
                })),
            })),
        }));
        const mockUpdate = vitest_1.vi.fn(() => ({
            eq: vitest_1.vi.fn(() => ({
                then: vitest_1.vi.fn((cb) => cb({ error: null })),
                select: vitest_1.vi.fn(() => ({ data: [{ id: 'session-uuid-123' }], error: null })),
            })),
            is: vitest_1.vi.fn(() => ({
                select: vitest_1.vi.fn(() => ({ data: [], error: null })),
            })),
        }));
        vitest_1.vi.doMock('@supabase/supabase-js', () => ({
            createClient: vitest_1.vi.fn(() => ({
                from: vitest_1.vi.fn((table) => ({
                    insert: mockInsert,
                    update: mockUpdate,
                    select: vitest_1.vi.fn(() => ({ data: [], error: null })),
                    delete: vitest_1.vi.fn(() => ({ eq: vitest_1.vi.fn(() => ({ error: null })) })),
                })),
            })),
        }));
        const sessionMod = await import('../services/session.service');
        sessionService = sessionMod.sessionService;
        const deviceMod = await import('../services/device.service');
        deviceService = deviceMod.deviceService;
        // Initialize with a mock stop publisher
        sessionService.init(vitest_1.vi.fn());
        // Clear any state from singleton
        sessionService.activeByDevice.clear();
        sessionService.activeByUser.clear();
        sessionService.graceTimers.clear();
    });
    (0, vitest_1.it)('should open a session and store in memory maps', async () => {
        const session = await sessionService.open('user-1', 'device-1');
        (0, vitest_1.expect)(session.userId).toBe('user-1');
        (0, vitest_1.expect)(session.deviceId).toBe('device-1');
        (0, vitest_1.expect)(session.sessionId).toBe('session-uuid-123');
        (0, vitest_1.expect)(sessionService.isActive('user-1')).toBe(true);
        (0, vitest_1.expect)(sessionService.isOwner('user-1', 'device-1')).toBe(true);
        (0, vitest_1.expect)(sessionService.getDeviceForUser('user-1')).toBe('device-1');
    });
    (0, vitest_1.it)('should return existing session when same user opens on same device (idempotent)', async () => {
        const session1 = await sessionService.open('user-1', 'device-1');
        const session2 = await sessionService.open('user-1', 'device-1');
        (0, vitest_1.expect)(session1.sessionId).toBe(session2.sessionId);
    });
    (0, vitest_1.it)('should reject with 409 when device is claimed by another user', async () => {
        await sessionService.open('user-1', 'device-1');
        try {
            await sessionService.open('user-2', 'device-1');
            vitest_1.expect.fail('Should have thrown');
        }
        catch (err) {
            (0, vitest_1.expect)(err.statusCode).toBe(409);
            (0, vitest_1.expect)(err.message).toContain('already claimed');
        }
    });
    (0, vitest_1.it)('should reject with 409 when user has session on another device', async () => {
        await sessionService.open('user-1', 'device-1');
        try {
            await sessionService.open('user-1', 'device-2');
            vitest_1.expect.fail('Should have thrown');
        }
        catch (err) {
            (0, vitest_1.expect)(err.statusCode).toBe(409);
            (0, vitest_1.expect)(err.message).toContain('another device');
        }
    });
    (0, vitest_1.it)('should close session and remove from both memory maps', async () => {
        await sessionService.open('user-1', 'device-1');
        sessionService.close('user-1', 'user_disconnect');
        (0, vitest_1.expect)(sessionService.isActive('user-1')).toBe(false);
        (0, vitest_1.expect)(sessionService.isOwner('user-1', 'device-1')).toBe(false);
        (0, vitest_1.expect)(sessionService.getActive('device-1')).toBeNull();
        (0, vitest_1.expect)(sessionService.getDeviceForUser('user-1')).toBeNull();
    });
    (0, vitest_1.it)('should be a no-op when closing nonexistent session', () => {
        // Should not throw
        (0, vitest_1.expect)(() => sessionService.close('nonexistent-user', 'test')).not.toThrow();
    });
    (0, vitest_1.it)('should emit session_change events', async () => {
        const listener = vitest_1.vi.fn();
        sessionService.on('session_change', listener);
        await sessionService.open('user-1', 'device-1');
        (0, vitest_1.expect)(listener).toHaveBeenCalledWith('device-1', vitest_1.expect.objectContaining({ userId: 'user-1' }));
        sessionService.close('user-1', 'test');
        (0, vitest_1.expect)(listener).toHaveBeenCalledWith('device-1', null);
    });
});
(0, vitest_1.describe)('SessionService — Grace Period', () => {
    let sessionService;
    (0, vitest_1.beforeEach)(async () => {
        vitest_1.vi.resetModules();
        vitest_1.vi.useFakeTimers();
        vitest_1.vi.doMock('../services/log.service', () => ({
            logService: { info: vitest_1.vi.fn(), warn: vitest_1.vi.fn(), error: vitest_1.vi.fn(), log: vitest_1.vi.fn(), getRecentLogs: vitest_1.vi.fn(() => []) },
        }));
        vitest_1.vi.doMock('../services/config.service', () => ({
            configService: { get: vitest_1.vi.fn(() => null), load: vitest_1.vi.fn() },
        }));
        vitest_1.vi.doMock('@supabase/supabase-js', () => ({
            createClient: vitest_1.vi.fn(() => ({
                from: vitest_1.vi.fn(() => ({
                    insert: vitest_1.vi.fn(() => ({
                        select: vitest_1.vi.fn(() => ({
                            single: vitest_1.vi.fn(() => ({ data: { id: 'session-uuid-grace' }, error: null })),
                        })),
                    })),
                    update: vitest_1.vi.fn(() => ({
                        eq: vitest_1.vi.fn(() => ({ then: vitest_1.vi.fn((cb) => cb({ error: null })) })),
                        is: vitest_1.vi.fn(() => ({ select: vitest_1.vi.fn(() => ({ data: [], error: null })) })),
                    })),
                })),
            })),
        }));
        const mod = await import('../services/session.service');
        sessionService = mod.sessionService;
        sessionService.init(vitest_1.vi.fn());
        sessionService.activeByDevice.clear();
        sessionService.activeByUser.clear();
        sessionService.graceTimers.clear();
    });
    (0, vitest_1.it)('should auto-close session after grace period timeout', async () => {
        await sessionService.open('user-1', 'device-1');
        (0, vitest_1.expect)(sessionService.isActive('user-1')).toBe(true);
        sessionService.startGracePeriod('device-1');
        // Advance time past the 30s grace period
        vitest_1.vi.advanceTimersByTime(31_000);
        (0, vitest_1.expect)(sessionService.isActive('user-1')).toBe(false);
        (0, vitest_1.expect)(sessionService.getActive('device-1')).toBeNull();
    });
    (0, vitest_1.it)('should cancel grace period on reconnect', async () => {
        await sessionService.open('user-1', 'device-1');
        sessionService.startGracePeriod('device-1');
        // Reconnect within window
        vitest_1.vi.advanceTimersByTime(10_000); // 10s < 30s
        sessionService.cancelGracePeriod('device-1');
        // Advance past original timeout
        vitest_1.vi.advanceTimersByTime(25_000);
        // Session should still be active (grace was cancelled)
        (0, vitest_1.expect)(sessionService.isActive('user-1')).toBe(true);
    });
    (0, vitest_1.it)('should not start duplicate grace timers', async () => {
        await sessionService.open('user-1', 'device-1');
        sessionService.startGracePeriod('device-1');
        sessionService.startGracePeriod('device-1'); // Should be no-op
        (0, vitest_1.expect)(sessionService.graceTimers.size).toBe(1);
    });
});
(0, vitest_1.describe)('SessionService — Memory Performance', () => {
    let sessionService;
    (0, vitest_1.beforeEach)(async () => {
        vitest_1.vi.resetModules();
        vitest_1.vi.doMock('../services/log.service', () => ({
            logService: { info: vitest_1.vi.fn(), warn: vitest_1.vi.fn(), error: vitest_1.vi.fn(), log: vitest_1.vi.fn(), getRecentLogs: vitest_1.vi.fn(() => []) },
        }));
        vitest_1.vi.doMock('../services/config.service', () => ({
            configService: { get: vitest_1.vi.fn(() => null), load: vitest_1.vi.fn() },
        }));
        vitest_1.vi.doMock('@supabase/supabase-js', () => ({
            createClient: vitest_1.vi.fn(() => ({
                from: vitest_1.vi.fn(() => ({
                    insert: vitest_1.vi.fn(() => ({
                        select: vitest_1.vi.fn(() => ({
                            single: vitest_1.vi.fn(() => ({ data: { id: 'perf-session' }, error: null })),
                        })),
                    })),
                    update: vitest_1.vi.fn(() => ({
                        eq: vitest_1.vi.fn(() => ({ then: vitest_1.vi.fn((cb) => cb({ error: null })) })),
                        is: vitest_1.vi.fn(() => ({ select: vitest_1.vi.fn(() => ({ data: [], error: null })) })),
                    })),
                })),
            })),
        }));
        const mod = await import('../services/session.service');
        sessionService = mod.sessionService;
        sessionService.init(vitest_1.vi.fn());
        sessionService.activeByDevice.clear();
        sessionService.activeByUser.clear();
    });
    (0, vitest_1.it)('isOwner should be a pure synchronous memory read (10k calls < 50ms)', async () => {
        await sessionService.open('user-1', 'device-1');
        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            sessionService.isOwner('user-1', 'device-1');
        }
        const elapsed = performance.now() - start;
        (0, vitest_1.expect)(elapsed).toBeLessThan(50);
    });
    (0, vitest_1.it)('getActive should be a pure synchronous memory read', async () => {
        await sessionService.open('user-1', 'device-1');
        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            sessionService.getActive('device-1');
        }
        const elapsed = performance.now() - start;
        (0, vitest_1.expect)(elapsed).toBeLessThan(50);
    });
});
