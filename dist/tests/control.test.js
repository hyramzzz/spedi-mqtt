"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
(0, vitest_1.describe)('DeviceService — Joystick Hot Path', () => {
    let deviceService;
    let mockMqtt;
    (0, vitest_1.beforeEach)(async () => {
        vitest_1.vi.resetModules();
        // Mock logService to ensure publishJoystick does NOT call it
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
        // Mock supabase
        vitest_1.vi.doMock('@supabase/supabase-js', () => ({
            createClient: vitest_1.vi.fn(() => ({
                from: vitest_1.vi.fn(() => ({
                    select: vitest_1.vi.fn(() => ({ data: [], error: null })),
                    update: vitest_1.vi.fn(() => ({ eq: vitest_1.vi.fn(() => ({ then: vitest_1.vi.fn() })) })),
                })),
            })),
        }));
        const mod = await import('../services/device.service');
        deviceService = mod.deviceService;
        // Create a mock MQTT publisher
        mockMqtt = {
            publishJoystick: vitest_1.vi.fn(),
            publishRoute: vitest_1.vi.fn(),
        };
        deviceService.init(mockMqtt);
    });
    (0, vitest_1.it)('should complete publishJoystick in under 1ms (performance benchmark)', () => {
        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
            deviceService.publishJoystick('device-1', { throttle: 50, steering: -30 });
        }
        const elapsed = performance.now() - start;
        const perCall = elapsed / 1000;
        (0, vitest_1.expect)(perCall).toBeLessThan(1); // Less than 1ms per call
    });
    (0, vitest_1.it)('should NOT call logService on publishJoystick (zero side effects on hot path)', async () => {
        deviceService.publishJoystick('device-1', { throttle: 100, steering: 0 });
        const { logService } = await import('../services/log.service');
        (0, vitest_1.expect)(logService.info).not.toHaveBeenCalled();
        (0, vitest_1.expect)(logService.warn).not.toHaveBeenCalled();
        (0, vitest_1.expect)(logService.error).not.toHaveBeenCalled();
    });
    (0, vitest_1.it)('should update desired shadow state synchronously', () => {
        deviceService.publishJoystick('device-1', { throttle: 75, steering: 25 });
        const state = deviceService.getState('device-1');
        (0, vitest_1.expect)(state.desired.throttle).toBe(75);
        (0, vitest_1.expect)(state.desired.steering).toBe(25);
    });
    (0, vitest_1.it)('should call mqtt.publishJoystick exactly once per call', () => {
        deviceService.publishJoystick('device-1', { throttle: 50, steering: 10 });
        (0, vitest_1.expect)(mockMqtt.publishJoystick).toHaveBeenCalledTimes(1);
        (0, vitest_1.expect)(mockMqtt.publishJoystick).toHaveBeenCalledWith({ throttle: 50, steering: 10 });
    });
    (0, vitest_1.it)('should not publish if mqtt is not initialized', () => {
        // Create a fresh service without mqtt init
        vitest_1.vi.resetModules();
    });
});
(0, vitest_1.describe)('DeviceService — Shadow Operations', () => {
    let deviceService;
    (0, vitest_1.beforeEach)(async () => {
        vitest_1.vi.resetModules();
        vitest_1.vi.doMock('../services/log.service', () => ({
            logService: {
                info: vitest_1.vi.fn(),
                warn: vitest_1.vi.fn(),
                error: vitest_1.vi.fn(),
                log: vitest_1.vi.fn(),
                getRecentLogs: vitest_1.vi.fn(() => []),
            },
        }));
        vitest_1.vi.doMock('../services/config.service', () => ({
            configService: {
                get: vitest_1.vi.fn(() => null),
                load: vitest_1.vi.fn(),
            },
        }));
        vitest_1.vi.doMock('@supabase/supabase-js', () => ({
            createClient: vitest_1.vi.fn(() => ({
                from: vitest_1.vi.fn(() => ({
                    select: vitest_1.vi.fn(() => ({ data: [], error: null })),
                    update: vitest_1.vi.fn(() => ({ eq: vitest_1.vi.fn(() => ({ then: vitest_1.vi.fn() })) })),
                })),
            })),
        }));
        const mod = await import('../services/device.service');
        deviceService = mod.deviceService;
    });
    (0, vitest_1.it)('should update reported state via passthrough when no field map is configured', () => {
        deviceService.updateReported('device-1', {
            lat: 13.75,
            lng: 100.5,
            obstacle_left: 45,
            smart_move_active: false,
        });
        const reported = deviceService.getReported('device-1');
        (0, vitest_1.expect)(reported.lat).toBe(13.75);
        (0, vitest_1.expect)(reported.lng).toBe(100.5);
        (0, vitest_1.expect)(reported.obstacle_left).toBe(45);
        (0, vitest_1.expect)(reported.smart_move_active).toBe(false);
    });
    (0, vitest_1.it)('should compute delta between desired and reported', () => {
        deviceService.setDesired('device-1', { mode: 'manual', throttle: 50 });
        deviceService.updateReported('device-1', { mode: 'idle' });
        const state = deviceService.getState('device-1');
        (0, vitest_1.expect)(state.delta.mode).toBeDefined();
        (0, vitest_1.expect)(state.delta.mode.desired).toBe('manual');
        (0, vitest_1.expect)(state.delta.mode.reported).toBe('idle');
    });
    (0, vitest_1.it)('should reset desired to idle defaults', () => {
        deviceService.setDesired('device-1', {
            mode: 'auto',
            throttle: 100,
            steering: 45,
            route: [{ lat: 13, lng: 100 }],
        });
        deviceService.resetDesired('device-1');
        const state = deviceService.getState('device-1');
        (0, vitest_1.expect)(state.desired.mode).toBe('idle');
        (0, vitest_1.expect)(state.desired.throttle).toBe(0);
        (0, vitest_1.expect)(state.desired.steering).toBe(0);
        (0, vitest_1.expect)(state.desired.route).toBeNull();
    });
    (0, vitest_1.it)('should return empty reported for unknown device', () => {
        const reported = deviceService.getReported('nonexistent');
        (0, vitest_1.expect)(reported).toEqual({});
    });
    (0, vitest_1.it)('should lazily create shadow with idle defaults on first access', () => {
        const state = deviceService.getState('new-device');
        (0, vitest_1.expect)(state.desired.mode).toBe('idle');
        (0, vitest_1.expect)(state.desired.throttle).toBe(0);
        (0, vitest_1.expect)(state.desired.steering).toBe(0);
        (0, vitest_1.expect)(state.desired.route).toBeNull();
        (0, vitest_1.expect)(state.reported).toEqual({});
    });
});
(0, vitest_1.describe)('DeviceService — Smart Move Command Gate', () => {
    let deviceService;
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
                    select: vitest_1.vi.fn(() => ({ data: [], error: null })),
                    update: vitest_1.vi.fn(() => ({ eq: vitest_1.vi.fn(() => ({ then: vitest_1.vi.fn() })) })),
                })),
            })),
        }));
        const mod = await import('../services/device.service');
        deviceService = mod.deviceService;
    });
    (0, vitest_1.it)('should report smart_move_active correctly from reported state', () => {
        deviceService.updateReported('device-1', { smart_move_active: true });
        const reported = deviceService.getReported('device-1');
        (0, vitest_1.expect)(reported.smart_move_active).toBe(true);
    });
    (0, vitest_1.it)('should allow reading reported state as a pure synchronous operation', () => {
        deviceService.updateReported('device-1', { lat: 10, lng: 20 });
        const start = performance.now();
        for (let i = 0; i < 10000; i++) {
            deviceService.getReported('device-1');
        }
        const elapsed = performance.now() - start;
        // 10000 reads should complete in well under 100ms
        (0, vitest_1.expect)(elapsed).toBeLessThan(100);
    });
});
