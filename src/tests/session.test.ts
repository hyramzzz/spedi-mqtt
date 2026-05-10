import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SessionService — Lifecycle', () => {
    let sessionService: any;
    let deviceService: any;

    beforeEach(async () => {
        vi.resetModules();

        // Mock logService
        vi.doMock('../services/log.service', () => ({
            logService: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                log: vi.fn(),
                getRecentLogs: vi.fn(() => []),
            },
        }));

        // Mock configService
        vi.doMock('../services/config.service', () => ({
            configService: {
                get: vi.fn(() => null),
                load: vi.fn(),
            },
        }));

        // Mock supabase with working insert/update/select chains
        const mockInsert = vi.fn(() => ({
            select: vi.fn(() => ({
                single: vi.fn(() => ({
                    data: { id: 'session-uuid-123' },
                    error: null,
                })),
            })),
        }));

        const mockUpdate = vi.fn(() => ({
            eq: vi.fn(() => ({
                then: vi.fn((cb: any) => cb({ error: null })),
                select: vi.fn(() => ({ data: [{ id: 'session-uuid-123' }], error: null })),
            })),
            is: vi.fn(() => ({
                select: vi.fn(() => ({ data: [], error: null })),
            })),
        }));

        vi.doMock('@supabase/supabase-js', () => ({
            createClient: vi.fn(() => ({
                from: vi.fn((table: string) => ({
                    insert: mockInsert,
                    update: mockUpdate,
                    select: vi.fn(() => ({ data: [], error: null })),
                    delete: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
                })),
            })),
        }));

        const sessionMod = await import('../services/session.service');
        sessionService = sessionMod.sessionService;

        const deviceMod = await import('../services/device.service');
        deviceService = deviceMod.deviceService;

        // Initialize with a mock stop publisher
        sessionService.init(vi.fn());

        // Clear any state from singleton
        (sessionService as any).activeByDevice.clear();
        (sessionService as any).activeByUser.clear();
        (sessionService as any).graceTimers.clear();
    });

    it('should open a session and store in memory maps', async () => {
        const session = await sessionService.open('user-1', 'device-1');

        expect(session.userId).toBe('user-1');
        expect(session.deviceId).toBe('device-1');
        expect(session.sessionId).toBe('session-uuid-123');
        expect(sessionService.isActive('user-1')).toBe(true);
        expect(sessionService.isOwner('user-1', 'device-1')).toBe(true);
        expect(sessionService.getDeviceForUser('user-1')).toBe('device-1');
    });

    it('should return existing session when same user opens on same device (idempotent)', async () => {
        const session1 = await sessionService.open('user-1', 'device-1');
        const session2 = await sessionService.open('user-1', 'device-1');

        expect(session1.sessionId).toBe(session2.sessionId);
    });

    it('should reject with 409 when device is claimed by another user', async () => {
        await sessionService.open('user-1', 'device-1');

        try {
            await sessionService.open('user-2', 'device-1');
            expect.fail('Should have thrown');
        } catch (err: any) {
            expect(err.statusCode).toBe(409);
            expect(err.message).toContain('already claimed');
        }
    });

    it('should reject with 409 when user has session on another device', async () => {
        await sessionService.open('user-1', 'device-1');

        try {
            await sessionService.open('user-1', 'device-2');
            expect.fail('Should have thrown');
        } catch (err: any) {
            expect(err.statusCode).toBe(409);
            expect(err.message).toContain('another device');
        }
    });

    it('should close session and remove from both memory maps', async () => {
        await sessionService.open('user-1', 'device-1');
        sessionService.close('user-1', 'user_disconnect');

        expect(sessionService.isActive('user-1')).toBe(false);
        expect(sessionService.isOwner('user-1', 'device-1')).toBe(false);
        expect(sessionService.getActive('device-1')).toBeNull();
        expect(sessionService.getDeviceForUser('user-1')).toBeNull();
    });

    it('should be a no-op when closing nonexistent session', () => {
        // Should not throw
        expect(() => sessionService.close('nonexistent-user', 'test')).not.toThrow();
    });

    it('should emit session_change events', async () => {
        const listener = vi.fn();
        sessionService.on('session_change', listener);

        await sessionService.open('user-1', 'device-1');
        expect(listener).toHaveBeenCalledWith('device-1', expect.objectContaining({ userId: 'user-1' }));

        sessionService.close('user-1', 'test');
        expect(listener).toHaveBeenCalledWith('device-1', null);
    });
});

describe('SessionService — Grace Period', () => {
    let sessionService: any;

    beforeEach(async () => {
        vi.resetModules();
        vi.useFakeTimers();

        vi.doMock('../services/log.service', () => ({
            logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(), getRecentLogs: vi.fn(() => []) },
        }));
        vi.doMock('../services/config.service', () => ({
            configService: { get: vi.fn(() => null), load: vi.fn() },
        }));
        vi.doMock('@supabase/supabase-js', () => ({
            createClient: vi.fn(() => ({
                from: vi.fn(() => ({
                    insert: vi.fn(() => ({
                        select: vi.fn(() => ({
                            single: vi.fn(() => ({ data: { id: 'session-uuid-grace' }, error: null })),
                        })),
                    })),
                    update: vi.fn(() => ({
                        eq: vi.fn(() => ({ then: vi.fn((cb: any) => cb({ error: null })) })),
                        is: vi.fn(() => ({ select: vi.fn(() => ({ data: [], error: null })) })),
                    })),
                })),
            })),
        }));

        const mod = await import('../services/session.service');
        sessionService = mod.sessionService;
        sessionService.init(vi.fn());
        (sessionService as any).activeByDevice.clear();
        (sessionService as any).activeByUser.clear();
        (sessionService as any).graceTimers.clear();
    });

    it('should auto-close session after grace period timeout', async () => {
        await sessionService.open('user-1', 'device-1');
        expect(sessionService.isActive('user-1')).toBe(true);

        sessionService.startGracePeriod('device-1');

        // Advance time past the 30s grace period
        vi.advanceTimersByTime(31_000);

        expect(sessionService.isActive('user-1')).toBe(false);
        expect(sessionService.getActive('device-1')).toBeNull();
    });

    it('should cancel grace period on reconnect', async () => {
        await sessionService.open('user-1', 'device-1');
        sessionService.startGracePeriod('device-1');

        // Reconnect within window
        vi.advanceTimersByTime(10_000); // 10s < 30s
        sessionService.cancelGracePeriod('device-1');

        // Advance past original timeout
        vi.advanceTimersByTime(25_000);

        // Session should still be active (grace was cancelled)
        expect(sessionService.isActive('user-1')).toBe(true);
    });

    it('should not start duplicate grace timers', async () => {
        await sessionService.open('user-1', 'device-1');

        sessionService.startGracePeriod('device-1');
        sessionService.startGracePeriod('device-1'); // Should be no-op

        expect((sessionService as any).graceTimers.size).toBe(1);
    });
});

describe('SessionService — Memory Performance', () => {
    let sessionService: any;

    beforeEach(async () => {
        vi.resetModules();

        vi.doMock('../services/log.service', () => ({
            logService: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), log: vi.fn(), getRecentLogs: vi.fn(() => []) },
        }));
        vi.doMock('../services/config.service', () => ({
            configService: { get: vi.fn(() => null), load: vi.fn() },
        }));
        vi.doMock('@supabase/supabase-js', () => ({
            createClient: vi.fn(() => ({
                from: vi.fn(() => ({
                    insert: vi.fn(() => ({
                        select: vi.fn(() => ({
                            single: vi.fn(() => ({ data: { id: 'perf-session' }, error: null })),
                        })),
                    })),
                    update: vi.fn(() => ({
                        eq: vi.fn(() => ({ then: vi.fn((cb: any) => cb({ error: null })) })),
                        is: vi.fn(() => ({ select: vi.fn(() => ({ data: [], error: null })) })),
                    })),
                })),
            })),
        }));

        const mod = await import('../services/session.service');
        sessionService = mod.sessionService;
        sessionService.init(vi.fn());
        (sessionService as any).activeByDevice.clear();
        (sessionService as any).activeByUser.clear();
    });

    it('isOwner should be a pure synchronous memory read (10k calls < 50ms)', async () => {
        await sessionService.open('user-1', 'device-1');

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            sessionService.isOwner('user-1', 'device-1');
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(50);
    });

    it('getActive should be a pure synchronous memory read', async () => {
        await sessionService.open('user-1', 'device-1');

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            sessionService.getActive('device-1');
        }
        const elapsed = performance.now() - start;

        expect(elapsed).toBeLessThan(50);
    });
});
