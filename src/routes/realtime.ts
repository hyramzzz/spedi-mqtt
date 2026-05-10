import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'crypto';
import { sseService } from '../services/sse.service';
import { deviceService } from '../services/device.service';
import { logService } from '../services/log.service';
import { cameraService } from '../services/camera.service';

const realtimeRoutes: FastifyPluginAsync = async (fastify) => {
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
        const connectionId = randomUUID();

        sseService.addClient(connectionId, reply);

        try {
            // Flush all active shadows (including emulator 'default')
            const activeDeviceIds = deviceService.getActiveShadowDeviceIds();

            for (const deviceId of activeDeviceIds) {
                const state = deviceService.getState(deviceId);

                if (Object.keys(state.reported).length > 0) {
                    sseService.sendToClient(connectionId, {
                        type: 'telemetry',
                        deviceId: deviceId,
                        payload: state.reported
                    });
                }
            }

            // Flush recent system logs
            const recentLogs = logService.getRecentLogs();
            // Send in reverse so oldest arrives first, or just send array? 
            // The dashboard expects individual events. We'll send them oldest-first
            // so the frontend appends them naturally.
            for (let i = recentLogs.length - 1; i >= 0; i--) {
                sseService.sendToClient(connectionId, {
                    type: 'syslog',
                    payload: recentLogs[i]
                });
            }

            // Flush latest camera snapshot if available
            const snapshot = cameraService.getLatestSnapshot();
            if (snapshot) {
                sseService.sendToClient(connectionId, {
                    type: 'camera_snapshot',
                    payload: {
                        timestamp: new Date().toISOString(), // Or store actual snapshot time
                        dataUri: snapshot
                    }
                });
            }

        } catch (err: any) {
            request.log.error(err, 'Failed to flush initial state for new SSE client');
        }

        // Wait indefinitely until the client drops connection to prevent Fastify resolving the handler
        await new Promise((resolve) => {
            request.raw.on('close', resolve);
        });

        return reply;
    });
};

export default realtimeRoutes;
