"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const sse_service_1 = require("../services/sse.service");
const device_service_1 = require("../services/device.service");
const log_service_1 = require("../services/log.service");
const camera_service_1 = require("../services/camera.service");
const realtimeRoutes = async (fastify) => {
    /**
     * GET /events
     * SSE stream for live telemetry, device status, and session changes.
     */
    fastify.get('/events', {
        preHandler: [fastify.authenticate],
        schema: {
            tags: ['Realtime'],
            summary: 'SSE event stream',
            description: 'Establishes a persistent Server-Sent Events connection. Streams telemetry, device_online/offline, session_change, syslog, and camera_snapshot events. On connection, flushes current shadow state, log history, and latest camera snapshot.',
            security: [{ BearerAuth: [] }],
            querystring: {
                type: 'object',
                properties: {
                    token: { type: 'string', description: 'JWT token (alternative to Authorization header for EventSource compatibility)' },
                },
            },
            response: {
                200: {
                    type: 'string',
                    description: 'text/event-stream',
                },
            },
        },
    }, async (request, reply) => {
        const connectionId = (0, crypto_1.randomUUID)();
        sse_service_1.sseService.addClient(connectionId, reply);
        try {
            // Flush all active shadows (including emulator 'default')
            const activeDeviceIds = device_service_1.deviceService.getActiveShadowDeviceIds();
            for (const deviceId of activeDeviceIds) {
                const state = device_service_1.deviceService.getState(deviceId);
                if (Object.keys(state.reported).length > 0) {
                    sse_service_1.sseService.sendToClient(connectionId, {
                        type: 'telemetry',
                        deviceId: deviceId,
                        payload: state.reported
                    });
                }
            }
            // Flush recent system logs
            const recentLogs = log_service_1.logService.getRecentLogs();
            // Send in reverse so oldest arrives first, or just send array? 
            // The dashboard expects individual events. We'll send them oldest-first
            // so the frontend appends them naturally.
            for (let i = recentLogs.length - 1; i >= 0; i--) {
                sse_service_1.sseService.sendToClient(connectionId, {
                    type: 'syslog',
                    payload: recentLogs[i]
                });
            }
            // Flush latest camera snapshot if available
            const snapshot = camera_service_1.cameraService.getLatestSnapshot();
            if (snapshot) {
                sse_service_1.sseService.sendToClient(connectionId, {
                    type: 'camera_snapshot',
                    payload: {
                        timestamp: new Date().toISOString(), // Or store actual snapshot time
                        dataUri: snapshot
                    }
                });
            }
        }
        catch (err) {
            request.log.error(err, 'Failed to flush initial state for new SSE client');
        }
        // Wait indefinitely until the client drops connection to prevent Fastify resolving the handler
        await new Promise((resolve) => {
            request.raw.on('close', resolve);
        });
        return reply;
    });
};
exports.default = realtimeRoutes;
