import { FastifyInstance } from 'fastify';

export default async function healthRoutes(fastify: FastifyInstance) {
    fastify.get('/health', {
        schema: {
            tags: ['System'],
            summary: 'Health check',
            description: 'Returns server status. No authentication required.',
            response: {
                200: {
                    type: 'object',
                    properties: {
                        status: { type: 'string', enum: ['ok'] },
                    },
                },
            },
        },
    }, async () => {
        return { status: 'ok' };
    });
}
