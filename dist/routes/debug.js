"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = debugRoutes;
const telemetry_service_1 = require("../services/telemetry.service");
const log_service_1 = require("../services/log.service");
const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
    },
};
async function debugRoutes(fastify) {
    /**
     * POST /debug/telemetry
     */
    fastify.post('/debug/telemetry', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Debug'],
            summary: 'Inject mock telemetry',
            description: 'Directly ingests a mock MQTT payload into the telemetry pipeline for testing purposes.',
            security: [{ BearerAuth: [] }],
            body: {
                type: 'object',
                required: ['topic', 'payload'],
                properties: {
                    topic: { type: 'string', example: 'spedi/vehicle/status' },
                    payload: { type: 'object', additionalProperties: true, example: { lat: 13.75, lng: 100.5, obstacle_left: 45, smart_move_active: false } },
                },
            },
            response: {
                200: { type: 'object', properties: { ok: { type: 'boolean' } } },
                403: ErrorResponse,
                500: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || (!user.is_superuser && process.env.NODE_ENV !== 'development')) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        const { topic, payload } = request.body;
        try {
            const buffer = Buffer.from(JSON.stringify(payload));
            telemetry_service_1.telemetryService.ingest(topic, buffer);
            log_service_1.logService.info('system', 'telemetry', `Injected mock telemetry on ${topic}`);
            return { ok: true };
        }
        catch (err) {
            request.log.error(err);
            return reply.status(500).send({ error: 'Failed to inject telemetry' });
        }
    });
}
