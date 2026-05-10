import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_ANON_KEY || ''
);

const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
        message: { type: 'string' },
    },
};

const TelemetryRecord = {
    type: 'object',
    properties: {
        id: { type: 'integer', example: 1042 },
        device_id: { type: 'string', example: 'default' },
        recorded_at: { type: 'string', format: 'date-time', example: '2024-03-20T14:30:00.000Z' },
        raw: {
            type: 'object',
            additionalProperties: true,
            description: 'Full raw telemetry payload as received from the device',
            example: {
                lat: 13.7563,
                lng: 100.5018,
                mode: 'manual',
                obstacle_left: 45,
                obstacle_right: 120,
                smart_move_active: false
            }
        },
    },
};

const telemetryRoutes: FastifyPluginAsync = async (fastify) => {
    /**
     * GET /telemetry
     * Cursor-based paginated query of historical telemetry records.
     */
    fastify.get('/telemetry', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Telemetry'],
            summary: 'Query telemetry history',
            description: 'Returns raw telemetry records for a device within an optional date range. Uses cursor-based pagination ordered by recorded_at DESC. No downsampling — raw records only.',
            security: [{ BearerAuth: [] }],
            querystring: {
                type: 'object',
                required: ['device_id'],
                properties: {
                    device_id: { type: 'string', description: 'Device ID to query telemetry for' },
                    from: { type: 'string', format: 'date-time', description: 'Start of date range (ISO 8601)' },
                    to: { type: 'string', format: 'date-time', description: 'End of date range (ISO 8601)' },
                    cursor: { type: 'string', description: 'Cursor for pagination — recorded_at value of the last record from the previous page' },
                    limit: { type: 'integer', default: 100, minimum: 1, maximum: 500, description: 'Number of records per page' },
                },
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        data: { type: 'array', items: TelemetryRecord },
                        next_cursor: { type: 'string', nullable: true, description: 'Cursor for the next page, null if no more records' },
                    },
                },
                400: ErrorResponse,
            },
        },
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { device_id, from, to, cursor, limit } = request.query as {
            device_id: string;
            from?: string;
            to?: string;
            cursor?: string;
            limit?: string;
        };

        if (!device_id) {
            return reply.code(400).send({ error: 'Bad Request', message: 'device_id is required' });
        }

        const pageSize = limit ? Math.min(parseInt(limit, 10), 500) : 100;

        // Build query — ordered by recorded_at DESC for most-recent-first
        let query = supabase
            .from('telemetry')
            .select('id, device_id, recorded_at, raw')
            .eq('device_id', device_id)
            .order('recorded_at', { ascending: false })
            .limit(pageSize + 1); // Fetch one extra to determine if there's a next page

        // Date range filters
        if (from) {
            query = query.gte('recorded_at', from);
        }
        if (to) {
            query = query.lte('recorded_at', to);
        }

        // Cursor-based pagination — fetch records older than the cursor
        if (cursor) {
            query = query.lt('recorded_at', cursor);
        }

        const { data, error } = await query;

        if (error) {
            request.log.error(error, 'Failed to query telemetry');
            return reply.code(500).send({ error: 'Internal Server Error', message: 'Failed to query telemetry' });
        }

        const records = data || [];
        let next_cursor: string | null = null;

        // If we got more records than pageSize, there's a next page
        if (records.length > pageSize) {
            records.pop(); // Remove the extra record
            const lastRecord = records[records.length - 1];
            next_cursor = lastRecord.recorded_at;
        }

        return { data: records, next_cursor };
    });
};

export default telemetryRoutes;
