"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const auth_service_1 = require("../services/auth.service");
const session_service_1 = require("../services/session.service");
const device_service_1 = require("../services/device.service");
/**
 * WebSocket /control handler — the joystick hot path.
 *
 * Connection: JWT verified once on upgrade. Active session confirmed
 * in memory. If either fails, socket is closed immediately.
 *
 * Messages: Each frame is parsed, session and command gating checked
 * in memory, then DeviceService.publishJoystick fires. Zero awaits.
 * Zero DB reads. All in-memory.
 *
 * Disconnect: 30s grace period starts. Reconnect within window
 * resumes session. Timer expiry closes session and publishes stop.
 */
const controlRoutes = async (fastify) => {
    fastify.get('/control', {
        websocket: true,
        schema: {
            tags: ['Realtime'],
            summary: 'WebSocket joystick control',
            description: 'WebSocket endpoint for real-time joystick commands. Authenticate via ?token=JWT query parameter. Send JSON frames: { type: "joystick", payload: { throttle: number, steering: number } }. Commands are gated by session ownership and smart_move state. Zero-await hot path.',
            querystring: {
                type: 'object',
                properties: {
                    token: { type: 'string', description: 'JWT access token' },
                },
                required: ['token'],
            },
        },
    }, (socket, request) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        const token = url.searchParams.get('token');
        if (!token) {
            socket.close(4001, 'Missing token');
            return;
        }
        auth_service_1.authService.verifyToken(token).then((user) => {
            if (!user) {
                socket.close(4001, 'Invalid or expired token');
                return;
            }
            const deviceId = session_service_1.sessionService.getDeviceForUser(user.id);
            if (!deviceId) {
                socket.close(4003, 'No active session');
                return;
            }
            if (!session_service_1.sessionService.isOwner(user.id, deviceId)) {
                socket.close(4003, 'Session not owned');
                return;
            }
            session_service_1.sessionService.cancelGracePeriod(deviceId);
            console.log(`🎮 WS connected: user=${user.id} device=${deviceId}`);
            socket.on('message', (raw) => {
                if (!session_service_1.sessionService.isOwner(user.id, deviceId)) {
                    return;
                }
                let msg;
                try {
                    msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
                }
                catch {
                    return;
                }
                if (msg.type === 'joystick' && msg.payload) {
                    const reported = device_service_1.deviceService.getReported(deviceId);
                    if (reported.smart_move_active === true) {
                        return;
                    }
                    const { throttle, steering } = msg.payload;
                    if (typeof throttle === 'number' && typeof steering === 'number') {
                        device_service_1.deviceService.publishJoystick(deviceId, { throttle, steering });
                    }
                }
            });
            socket.on('close', () => {
                console.log(`🎮 WS disconnected: user=${user.id} device=${deviceId}`);
                session_service_1.sessionService.startGracePeriod(deviceId);
            });
            socket.on('error', (err) => {
                console.error(`🎮 WS error: user=${user.id}`, err.message);
            });
        }).catch((err) => {
            console.error('WS auth error:', err);
            socket.close(4001, 'Authentication failed');
        });
    });
};
exports.default = controlRoutes;
