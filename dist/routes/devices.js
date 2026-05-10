"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = deviceRoutes;
const device_service_1 = require("../services/device.service");
const session_service_1 = require("../services/session.service");
const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
    },
};
const DeviceRecord = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string' },
        mqtt_client_id: { type: 'string' },
        owner_id: { type: 'string', format: 'uuid' },
        created_at: { type: 'string', format: 'date-time' },
        last_seen_at: { type: 'string', format: 'date-time', nullable: true },
    },
};
const WaypointSchema = {
    type: 'object',
    properties: {
        lat: { type: 'number' },
        lng: { type: 'number' },
    },
};
const DeviceState = {
    type: 'object',
    properties: {
        desired: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['idle', 'manual', 'auto'] },
                throttle: { type: 'number' },
                steering: { type: 'number' },
                route: { type: 'array', items: WaypointSchema, nullable: true },
            },
        },
        reported: {
            type: 'object',
            properties: {
                mode: { type: 'string', nullable: true },
                lat: { type: 'number', nullable: true },
                lng: { type: 'number', nullable: true },
                obstacle_left: { type: 'number', nullable: true },
                obstacle_right: { type: 'number', nullable: true },
                smart_move_active: { type: 'boolean', nullable: true },
                waypoint_index: { type: 'number', nullable: true },
            },
        },
        delta: { type: 'object', additionalProperties: true },
        session: {
            type: 'object',
            nullable: true,
            properties: {
                sessionId: { type: 'string', format: 'uuid' },
                userId: { type: 'string', format: 'uuid' },
                connectedAt: { type: 'string', format: 'date-time' },
                active: { type: 'boolean' },
            },
        },
    },
};
async function deviceRoutes(fastify) {
    /**
     * GET /devices
     */
    fastify.get('/devices', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Devices'],
            summary: 'List all devices',
            description: 'Returns all registered devices.',
            security: [{ BearerAuth: [] }],
            response: {
                200: { type: 'array', items: DeviceRecord },
            },
        },
    }, async (request, reply) => {
        const devices = await device_service_1.deviceService.listDevices();
        return devices;
    });
    /**
     * GET /devices/:id
     */
    fastify.get('/devices/:id', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Devices'],
            summary: 'Get device by ID',
            description: 'Returns the full device record.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' } },
            },
            response: {
                200: DeviceRecord,
                404: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const { id } = request.params;
        const device = await device_service_1.deviceService.getDeviceById(id);
        if (!device) {
            return reply.status(404).send({ error: 'Device not found' });
        }
        return device;
    });
    /**
     * POST /devices
     */
    fastify.post('/devices', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Devices'],
            summary: 'Register a new device',
            description: 'Creates a new device record. Superuser only.',
            security: [{ BearerAuth: [] }],
            body: {
                type: 'object',
                required: ['name', 'mqtt_client_id'],
                properties: {
                    name: { type: 'string', example: 'test-boat-01' },
                    mqtt_client_id: { type: 'string', example: 'test-client-01' },
                },
                example: {
                    name: 'test-boat-01',
                    mqtt_client_id: 'test-client-01'
                }
            },
            response: {
                201: DeviceRecord,
                400: ErrorResponse,
                403: ErrorResponse,
                500: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || !user.is_superuser) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        const { name, mqtt_client_id } = request.body;
        if (!name || !mqtt_client_id) {
            return reply.status(400).send({ error: 'Missing required fields: name, mqtt_client_id' });
        }
        try {
            const device = await device_service_1.deviceService.registerDevice(name, mqtt_client_id, user.id);
            return reply.status(201).send(device);
        }
        catch (err) {
            request.log.error(err);
            return reply.status(500).send({ error: 'Failed to register device' });
        }
    });
    /**
     * GET /devices/:id/state
     */
    fastify.get('/devices/:id/state', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Devices'],
            summary: 'Get device shadow state',
            description: 'Returns the full shadow state (desired, reported, delta) and active session info. All reads are from memory — zero DB queries.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' } },
            },
            response: {
                200: DeviceState,
                404: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const { id } = request.params;
        const device = await device_service_1.deviceService.getDeviceById(id);
        if (!device) {
            return reply.status(404).send({ error: 'Device not found' });
        }
        const state = device_service_1.deviceService.getState(id);
        const activeSession = session_service_1.sessionService.getActive(id);
        return {
            ...state,
            session: activeSession
                ? {
                    sessionId: activeSession.sessionId,
                    userId: activeSession.userId,
                    connectedAt: activeSession.connectedAt,
                    active: true,
                }
                : null,
        };
    });
    /**
     * OPTIONS /devices/:id
     * Explicit handler to fix Fastify eating CORS headers on parametric DELETE routes
     */
    fastify.options('/devices/:id', async (request, reply) => {
        return reply
            .header('Access-Control-Allow-Origin', 'https://spedi-core.vercel.app')
            .header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
            .header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization')
            .header('Access-Control-Allow-Credentials', 'true')
            .status(204)
            .send();
    });
    /**
     * PUT /devices/:id
     */
    fastify.put('/devices/:id', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Devices'],
            summary: 'Update device',
            description: 'Updates a device\'s name and/or MQTT client ID. Superuser only.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' } },
            },
            body: {
                type: 'object',
                properties: {
                    name: { type: 'string', minLength: 1 },
                    mqtt_client_id: { type: 'string', minLength: 1 },
                },
                example: {
                    name: 'Updated Boat Name',
                    mqtt_client_id: 'updated-client-id'
                }
            },
            response: {
                200: DeviceRecord,
                400: ErrorResponse,
                403: ErrorResponse,
                404: ErrorResponse,
                500: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || !user.is_superuser) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        const { id } = request.params;
        const { name, mqtt_client_id } = request.body;
        if (!name && !mqtt_client_id) {
            return reply.status(400).send({ error: 'At least one field (name or mqtt_client_id) must be provided to update' });
        }
        const device = await device_service_1.deviceService.getDeviceById(id);
        if (!device) {
            return reply.status(404).send({ error: 'Device not found' });
        }
        try {
            const updated = await device_service_1.deviceService.updateDevice(id, name, mqtt_client_id);
            return updated;
        }
        catch (err) {
            request.log.error(err);
            return reply.status(500).send({ error: 'Failed to update device' });
        }
    });
    /**
     * DELETE /devices/:id
     */
    fastify.delete('/devices/:id', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Devices'],
            summary: 'Delete a device',
            description: 'Removes a device. Superuser only. Fails if device has an active session.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' } },
            },
            response: {
                200: { type: 'object', properties: { ok: { type: 'boolean' } } },
                403: ErrorResponse,
                404: ErrorResponse,
                409: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || !user.is_superuser) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        const { id } = request.params;
        const device = await device_service_1.deviceService.getDeviceById(id);
        if (!device) {
            return reply.status(404).send({ error: 'Device not found' });
        }
        // Block deletion if device has an active session
        const activeSession = session_service_1.sessionService.getActive(id);
        if (activeSession) {
            return reply.status(409).send({ error: 'Cannot delete device with an active session' });
        }
        try {
            await device_service_1.deviceService.deleteDevice(id);
            return { ok: true };
        }
        catch (err) {
            request.log.error(err);
            return reply.status(500).send({ error: 'Failed to delete device' });
        }
    });
}
