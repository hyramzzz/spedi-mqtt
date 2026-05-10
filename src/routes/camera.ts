import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { cameraService } from '../services/camera.service';

const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
    },
};

export default async function cameraRoutes(fastify: FastifyInstance) {
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
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const snapshot = cameraService.getLatestSnapshot();

        if (!snapshot) {
            return reply.status(404).send({ error: 'No camera snapshots available' });
        }

        return {
            timestamp: new Date().toISOString(),
            dataUri: snapshot
        };
    });
}
