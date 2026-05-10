"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = cameraRoutes;
const camera_service_1 = require("../services/camera.service");
const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
    },
};
async function cameraRoutes(fastify) {
    /**
     * GET /camera
     */
    fastify.get('/camera', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Camera'],
            summary: 'Get latest camera snapshot',
            description: 'Returns the most recently ingested camera snapshot as a Base64 data URI. This allows fetching the current frame without connecting to the live SSE stream.',
            security: [{ BearerAuth: [] }],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        timestamp: { type: 'string', format: 'date-time' },
                        dataUri: { type: 'string' }
                    }
                },
                404: ErrorResponse
            }
        }
    }, async (request, reply) => {
        const snapshot = camera_service_1.cameraService.getLatestSnapshot();
        if (!snapshot) {
            return reply.status(404).send({ error: 'No camera snapshots available' });
        }
        return {
            timestamp: new Date().toISOString(),
            dataUri: snapshot
        };
    });
}
