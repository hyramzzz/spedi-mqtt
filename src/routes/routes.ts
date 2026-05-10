import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { routeService } from '../services/route.service';

const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
        message: { type: 'string' },
    },
};

const WaypointSchema = {
    type: 'object',
    properties: {
        lat: { type: 'number' },
        lng: { type: 'number' },
    },
};

const RouteRecord = {
    type: 'object',
    properties: {
        id: { type: 'string', format: 'uuid', example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479' },
        device_id: { type: 'string', format: 'uuid', example: 'b0289f64-d3a9-467f-94a2-140682701416' },
        created_by: { type: 'string', format: 'uuid', example: 'd3b07384-d990-4e92-a034-927395c966f3' },
        name: { type: 'string', example: 'Riverside Patrol' },
        waypoints: { type: 'array', items: WaypointSchema, example: [{ lat: 13.7563, lng: 100.5018 }, { lat: 13.7570, lng: 100.5025 }] },
        status: { type: 'string', enum: ['draft', 'active', 'completed', 'aborted'], example: 'draft' },
        created_at: { type: 'string', format: 'date-time', example: '2024-03-20T14:30:00.000Z' },
        dispatched_at: { type: 'string', format: 'date-time', nullable: true, example: null },
        completed_at: { type: 'string', format: 'date-time', nullable: true, example: null },
    },
};

const routeRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /routes
     */
    fastify.get('/routes', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Routes'],
            summary: 'List routes',
            description: 'Paginated list of routes. Filter by device_id and status.',
            security: [{ BearerAuth: [] }],
            querystring: {
                type: 'object',
                properties: {
                    device_id: { type: 'string', format: 'uuid' },
                    status: { type: 'string', enum: ['draft', 'active', 'completed', 'aborted'] },
                    limit: { type: 'integer', default: 50, minimum: 1, maximum: 100 },
                    offset: { type: 'integer', default: 0, minimum: 0 },
                },
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        data: { type: 'array', items: RouteRecord },
                        count: { type: 'integer' },
                    },
                },
            },
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { device_id, status, limit, offset } = request.query as {
            device_id?: string;
            status?: string;
            limit?: string;
            offset?: string;
        };

        const parsedLimit = limit ? parseInt(limit, 10) : 50;
        const parsedOffset = offset ? parseInt(offset, 10) : 0;

        const result = await routeService.list(
            { device_id, status },
            { limit: parsedLimit, offset: parsedOffset }
        );
        return result;
    });

    /**
     * POST /routes
     */
    fastify.post('/routes', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Routes'],
            summary: 'Create a draft route',
            description: 'Creates a new route in draft status. Requires ≥2 waypoints with valid coordinates.',
            security: [{ BearerAuth: [] }],
            body: {
                type: 'object',
                required: ['device_id', 'name', 'waypoints'],
                properties: {
                    device_id: { type: 'string', example: '00000000-0000-0000-0000-000000000000' },
                    name: { type: 'string', minLength: 1, example: 'Bangkok River Patrol' },
                    waypoints: {
                        type: 'array',
                        minItems: 2,
                        items: {
                            type: 'object',
                            required: ['lat', 'lng'],
                            properties: {
                                lat: { type: 'number', example: 13.7563 },
                                lng: { type: 'number', example: 100.5018 },
                            },
                        },
                        example: [
                            { lat: 13.7563, lng: 100.5018 },
                            { lat: 13.7570, lng: 100.5025 },
                            { lat: 13.7580, lng: 100.5030 },
                        ],
                    },
                },
                example: {
                    device_id: '00000000-0000-0000-0000-000000000000',
                    name: 'Bangkok River Patrol',
                    waypoints: [
                        { lat: 13.7563, lng: 100.5018 },
                        { lat: 13.7570, lng: 100.5025 },
                        { lat: 13.7580, lng: 100.5030 }
                    ]
                }
            },
            response: {
                201: RouteRecord,
                400: ErrorResponse,
                500: ErrorResponse,
            },
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { device_id, name, waypoints } = request.body as {
            device_id: string;
            name: string;
            waypoints: Array<{ lat: number; lng: number }>;
        };

        if (!device_id || !name) {
            return reply.code(400).send({ error: 'Bad Request', message: 'device_id and name are required' });
        }

        if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) {
            return reply.code(400).send({ error: 'Bad Request', message: 'At least 2 waypoints are required' });
        }

        for (const wp of waypoints) {
            if (typeof wp.lat !== 'number' || typeof wp.lng !== 'number') {
                return reply.code(400).send({ error: 'Bad Request', message: 'Each waypoint must have numeric lat and lng' });
            }
        }

        try {
            const route = await routeService.create(device_id, request.user!.id, name, waypoints);
            return reply.code(201).send(route);
        } catch (err: any) {
            request.log.error(err, 'Failed to create route');
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    /**
     * GET /routes/:id
     */
    fastify.get('/routes/:id', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Routes'],
            summary: 'Get route by ID',
            description: 'Returns the full route record including waypoints.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' } },
            },
            response: {
                200: RouteRecord,
                404: ErrorResponse,
            },
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        const route = await routeService.getById(id);
        if (!route) {
            return reply.code(404).send({ error: 'Not Found' });
        }
        return route;
    });

    /**
     * DELETE /routes/:id
     */
    fastify.delete('/routes/:id', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Routes'],
            summary: 'Delete a draft route',
            description: 'Deletes a route. Only routes in draft status can be deleted.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' } },
            },
            response: {
                200: {
                    type: 'object',
                    properties: { message: { type: 'string' } },
                },
                403: ErrorResponse,
                404: ErrorResponse,
                409: ErrorResponse,
            },
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        try {
            await routeService.deleteDraft(id, request.user!.id);
            return reply.code(200).send({ message: 'Route deleted' });
        } catch (err: any) {
            if (err.statusCode) {
                return reply.code(err.statusCode).send({ error: err.message });
            }
            request.log.error(err, 'Failed to delete route');
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    /**
     * POST /routes/:id/start
     */
    fastify.post('/routes/:id/start', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Routes'],
            summary: 'Dispatch a route',
            description: 'Starts an autonomous route. Validates: route is draft/aborted, no active route on device, active session exists. Publishes waypoints to device via MQTT. Accepts empty bodies.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' } },
            },
            body: {
                type: 'object',
                additionalProperties: true, // explicitly permit empty `{}`
            },
            response: {
                200: RouteRecord,
                403: ErrorResponse,
                404: ErrorResponse,
                409: ErrorResponse,
            },
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        try {
            const route = await routeService.dispatch(id, request.user!.id);
            return reply.code(200).send(route);
        } catch (err: any) {
            if (err.statusCode) {
                return reply.code(err.statusCode).send({ error: err.message });
            }
            request.log.error(err, 'Failed to dispatch route');
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });

    /**
     * POST /routes/:id/stop
     */
    fastify.post('/routes/:id/stop', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Routes'],
            summary: 'Abort an active route',
            description: 'Aborts an active route. Resets desired state to idle and publishes stop_route to the device. Accepts empty bodies.',
            security: [{ BearerAuth: [] }],
            params: {
                type: 'object',
                properties: { id: { type: 'string', format: 'uuid' } },
            },
            body: {
                type: 'object',
                additionalProperties: true, // explicitly permit empty `{}`
            },
            response: {
                200: {
                    type: 'object',
                    properties: { message: { type: 'string' } },
                },
                403: ErrorResponse,
                404: ErrorResponse,
                409: ErrorResponse,
            },
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };
        try {
            await routeService.abort(id, request.user!.id);
            return reply.code(200).send({ message: 'Route aborted' });
        } catch (err: any) {
            if (err.statusCode) {
                return reply.code(err.statusCode).send({ error: err.message });
            }
            request.log.error(err, 'Failed to abort route');
            return reply.code(500).send({ error: 'Internal Server Error' });
        }
    });
};

export default routeRoutes;
