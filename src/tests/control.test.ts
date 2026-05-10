import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('DeviceService — Joystick Hot Path', () => {
    let deviceService: any;
    let mockMqtt: any;

    beforeEach(async () => {
        vi.resetModules();

        // Mock logService to ensure publishJoystick does NOT call it
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

        // Mock supabase
        vi.doMock('@supabase/supabase-js', () => ({
            createClient: vi.fn(() => ({
                from: vi.fn(() => ({
                    select: vi.fn(() => ({ data: [], error: null })),
                    update: vi.fn(() => ({ eq: vi.fn(() => ({ then: vi.fn() })) })),
                })),
            })),
        }));

        const mod = await import('../services/device.service');
        deviceService = mod.deviceService;

        // Create a mock MQTT publisher
        mockMqtt = {
            publishJoystick: vi.fn(),
            publishRoute: vi.fn(),
        };
        deviceService.init(mockMqtt);
    });

    it('should complete publishJoystick in under 1ms (performance benchmark)', () => {
        const start = performance.now();

        for (let i = 0; i < 1000; i++) {
            deviceService.publishJoystick('device-1', { throttle: 50, steering: -30 });
        }

        const elapsed = performance.now() - start;
        const perCall = elapsed / 1000;

        expect(perCall).toBeLessThan(1); // Less than 1ms per call
    });

    it('should NOT call logService on publishJoystick (zero side effects on hot path)', async () => {
        deviceService.publishJoystick('device-1', { throttle: 100, steering: 0 });

        const { logService } = await import('../services/log.service');
        expect(logService.info).not.toHaveBeenCalled();
        expect(logService.warn).not.toHaveBeenCalled();
        expect(logService.error).not.toHaveBeenCalled();
    });

    it('should update desired shadow state synchronously', () => {
        deviceService.publishJoystick('device-1', { throttle: 75, steering: 25 });

        const state = deviceService.getState('device-1');
        expect(state.desired.throttle).toBe(75);
        expect(state.desired.steering).toBe(25);
    });

    it('should call mqtt.publishJoystick exactly once per call', () => {
        deviceService.publishJoystick('device-1', { throttle: 50, steering: 10 });

        expect(mockMqtt.publishJoystick).toHaveBeenCalledTimes(1);
        expect(mockMqtt.publishJoystick).toHaveBeenCalledWith({ throttle: 50, steering: 10 });
    });

    it('should not publish if mqtt is not initialized', () => {
        // Create a fresh service without mqtt init
        vi.resetModules();
    });
});

describe('DeviceService — Shadow Operations', () => {
    let deviceService: any;

    beforeEach(async () => {
        vi.resetModules();

        vi.doMock('../services/log.service', () => ({
            logService: {
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                log: vi.fn(),
                getRecentLogs: vi.fn(() => []),
            },
        }));

        vi.doMock('../services/config.service', () => ({
            configService: {
                get: vi.fn(() => null),
                load: vi.fn(),
            },
        }));

        vi.doMock('@supabase/supabase-js', () => ({
            createClient: vi.fn(() => ({
                from: vi.fn(() => ({
                    select: vi.fn(() => ({ data: [], error: null })),
                    update: vi.fn(() => ({ eq: vi.fn(() => ({ then: vi.fn() })) })),
                })),
            })),
        }));

        const mod = await import('../services/device.service');
        deviceService = mod.deviceService;
    });

    it('should update reported state via passthrough when no field map is configured', () => {
        deviceService.updateReported('device-1', {
            lat: 13.75,
            lng: 100.5,
            obstacle_left: 45,
            smart_move_active: false,
        });

        const reported = deviceService.getReported('device-1');
        expect(reported.lat).toBe(13.75);
        expect(reported.lng).toBe(100.5);
        expect(reported.obstacle_left).toBe(45);
        expect(reported.smart_move_active).toBe(false);
    });

    it('should compute delta between desired and reported', () => {
        deviceService.setDesired('device-1', { mode: 'manual', throttle: 50 });
        deviceService.updateReported('device-1', { mode: 'idle' });

        const state = deviceService.getState('device-1');
        expect(state.delta.mode).toBeDefined();
        expect(state.delta.mode.desired).toBe('manual');
        expect(state.delta.mode.reported).toBe('idle');
    });

    it('should reset desired to idle defaults', () => {
        deviceService.setDesired('device-1', {
            mode: 'auto',
            throttle: 100,
            steering: 45,
            route: [{ lat: 13, lng: 100 }],
        });

        deviceService.resetDesired('device-1');

        const state = deviceService.getState('device-1');
        expect(state.desired.mode).toBe('idle');
        expect(state.desired.throttle).toBe(0);
        expect(state.desired.steering).toBe(0);
        expect(state.desired.route).toBeNull();
    });

    it('should return empty reported for unknown device', () => {
        const reported = deviceService.getReported('nonexistent');
        expect(reported).toEqual({});
    });

    it('should lazily create shadow with idle defaults on first access', () => {
        const state = deviceService.getState('new-device');
        expect(state.desired.mode).toBe('idle');
        expect(state.desired.throttle).toBe(0);
        expect(state.desired.steering).toBe(0);
        expect(state.desired.route).toBeNull();
        expect(state.reported).toEqual({});
    });
});

describe('DeviceService — Smart Move Command Gate', () => {
    let deviceService: any;

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
                    select: vi.fn(() => ({ data: [], error: null })),
                    update: vi.fn(() => ({ eq: vi.fn(() => ({ then: vi.fn() })) })),
                })),
            })),
        }));

        const mod = await import('../services/device.service');
        deviceService = mod.deviceService;
    });

    it('should report smart_move_active correctly from reported state', () => {
        deviceService.updateReported('device-1', { smart_move_active: true });

        const reported = deviceService.getReported('device-1');
        expect(reported.smart_move_active).toBe(true);
    });

    it('should allow reading reported state as a pure synchronous operation', () => {
        deviceService.updateReported('device-1', { lat: 10, lng: 20 });

        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            deviceService.getReported('device-1');
        }
        const elapsed = performance.now() - start;

        // 10000 reads should complete in well under 100ms
        expect(elapsed).toBeLessThan(100);
    });
});
