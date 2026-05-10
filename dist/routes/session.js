"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const session_service_1 = require("../services/session.service");
const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
        message: { type: 'string' },
    },
};
const ActiveSessionSchema = {
    type: 'object',
    nullable: true,
    properties: {
        sessionId: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        deviceId: { type: 'string' },
        connectedAt: { type: 'string', format: 'date-time' },
    },
};
const sessionRoutes = async (fastify) => {
    /**
     * POST /session
     */
    fastify.post('/session', {
        preHandler: [fastify.authenticate],
        schema: {
            tags: ['Sessions'],
            summary: 'Open a control session',
            description: 'Opens a control session for a device. Returns 409 if the device is already claimed by another user. Sets desired.mode to manual.',
            security: [{ BearerAuth: [] }],
            body: {
                type: 'object',
                required: ['device_id'],
                properties: {
                    device_id: { type: 'string', example: '00000000-0000-0000-0000-000000000000' },
                },
                example: {
                    device_id: '00000000-0000-0000-0000-000000000000'
                }
            },
            response: {
                200: ActiveSessionSchema,
                400: ErrorResponse,
                409: ErrorResponse,
                500: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const { device_id } = request.body;
        if (!device_id) {
            return reply.code(400).send({ error: 'Bad Request', message: 'device_id is required' });
        }
        try {
            const session = await session_service_1.sessionService.open(request.user.id, device_id);
            return reply.code(200).send(session);
        }
        catch (err) {
            if (err.statusCode === 409) {
                return reply.code(409).send({ error: 'Conflict', message: err.message });
            }
            request.log.error(err, 'Failed to open session');
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
    /**
     * GET /session
     */
    fastify.get('/session', {
        preHandler: [fastify.authenticate],
        schema: {
            tags: ['Sessions'],
            summary: 'Get active session',
            description: 'Returns the active session for the requesting user, or null if no session is active.',
            security: [{ BearerAuth: [] }],
            response: {
                200: ActiveSessionSchema,
            },
        },
    }, async (request, reply) => {
        const deviceId = session_service_1.sessionService.getDeviceForUser(request.user.id);
        if (!deviceId) {
            return reply.code(200).send(null);
        }
        const session = session_service_1.sessionService.getActive(deviceId);
        return reply.code(200).send(session);
    });
    /**
     * DELETE /session
     */
    fastify.delete('/session', {
        preHandler: [fastify.authenticate],
        schema: {
            tags: ['Sessions'],
            summary: 'Close active session',
            description: 'Closes the active session for the requesting user. Resets desired state to idle and publishes a stop command to the device. Accepts empty bodies.',
            security: [{ BearerAuth: [] }],
            body: {
                type: 'object',
                additionalProperties: true, // explicitly permit empty `{}`
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        message: { type: 'string' },
                    },
                },
                404: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const deviceId = session_service_1.sessionService.getDeviceForUser(request.user.id);
        if (!deviceId) {
            return reply.code(404).send({ error: 'Not Found', message: 'No active session' });
        }
        session_service_1.sessionService.close(request.user.id, 'user_disconnect');
        return reply.code(200).send({ message: 'Session closed' });
    });
};
exports.default = sessionRoutes;
