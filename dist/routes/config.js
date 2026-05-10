"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = configRoutes;
const config_service_1 = require("../services/config.service");
const mqtt_service_1 = require("../services/mqtt.service");
const ErrorResponse = {
    type: 'object',
    properties: {
        error: { type: 'string' },
    },
};
// ── System Endpoints (immutable, deployment-derived) ──────────────────
/** Keys that should not be editable via the dashboard config table. */
const IMMUTABLE_KEYS = ['mqtt_broker_host', 'mqtt_broker_port'];
/** Lazily computed and cached. Refreshed only on explicit call to rebuildCache(). */
let cachedSystemEndpoints = null;
function buildSystemEndpoints() {
    // Railway injects RAILWAY_PUBLIC_DOMAIN on public services.
    // Fallback to a well-known production URL if not available (e.g., local dev).
    const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.PUBLIC_DOMAIN || '';
    const apiBase = publicDomain
        ? `https://${publicDomain}`
        : (process.env.NEXT_PUBLIC_API_URL || `http://127.0.0.1:${process.env.PORT || 3000}`);
    const wsBase = apiBase.replace(/^http/, 'ws');
    const mqttPublicHost = process.env.MQTT_PUBLIC_HOST || 'centerbeam.proxy.rlwy.net';
    const mqttPublicPort = process.env.MQTT_PUBLIC_PORT || '14546';
    const mqttInternalHost = config_service_1.configService.get('mqtt_broker_host') || 'mosquitto';
    const mqttInternalPort = config_service_1.configService.get('mqtt_broker_port') || '1883';
    return [
        { label: 'REST API Base', value: apiBase },
        { label: 'SSE Event Stream', value: `${apiBase}/events?token=<JWT>` },
        { label: 'WebSocket Control', value: `${wsBase}/control?token=<JWT>` },
        { label: 'MQTT Public Proxy', value: `${mqttPublicHost} : ${mqttPublicPort}` },
        { label: 'MQTT Internal (Railway)', value: `${mqttInternalHost}.railway.internal : ${mqttInternalPort}` },
        { label: 'MQTT Device Creds', value: 'device : spedi2026' },
        { label: 'MQTT Server Creds', value: 'server : spedi2026' },
    ];
}
function getSystemEndpoints() {
    if (!cachedSystemEndpoints) {
        cachedSystemEndpoints = buildSystemEndpoints();
    }
    return cachedSystemEndpoints;
}
function rebuildSystemEndpointsCache() {
    cachedSystemEndpoints = buildSystemEndpoints();
}
const ConfigEntry = {
    type: 'object',
    properties: {
        id: { type: 'number', example: 1 },
        key: { type: 'string', example: 'telemetry_interval_ms' },
        value: { type: 'string', example: '1000' },
        description: { type: 'string', nullable: true, example: 'Frequency of telemetry updates from the device' },
        updated_at: { type: 'string', format: 'date-time', example: '2024-03-20T14:30:00.000Z' },
        updated_by: { type: 'string', format: 'uuid', nullable: true, example: 'd3b07384-d990-4e92-a034-927395c966f3' },
    },
};
async function configRoutes(fastify) {
    /**
     * GET /config
     */
    fastify.get('/config', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Config'],
            summary: 'Get all configuration entries',
            description: 'Returns all system configuration key-value pairs, immutable keys list, and deployment-derived system endpoints. Superuser only.',
            security: [{ BearerAuth: [] }],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        config: { type: 'array', items: ConfigEntry },
                        immutableKeys: { type: 'array', items: { type: 'string' } },
                        endpoints: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    label: { type: 'string' },
                                    value: { type: 'string' },
                                },
                            },
                        },
                    },
                },
                403: ErrorResponse,
            },
        },
    }, async (request, reply) => {
        const user = request.user;
        if (!user || !user.is_superuser) {
            return reply.status(403).send({ error: 'Forbidden: Superuser access required' });
        }
        const config = config_service_1.configService.getAll();
        // Ensure camera channel is visible in the list even if not in DB yet
        if (!config.find(c => c.key === 'mqtt_topic_camera')) {
            config.push({
                id: -1,
                key: 'mqtt_topic_camera',
                value: 'spedi/vehicle/camera',
                description: 'MQTT topic for camera stream (read/write)',
                updated_at: new Date().toISOString(),
                updated_by: null
            });
        }
        return {
            config,
            immutableKeys: IMMUTABLE_KEYS,
            endpoints: getSystemEndpoints(),
        };
    });
    /**
     * PUT /config
     */
    fastify.put('/config', {
        onRequest: [fastify.authenticate],
        schema: {
            tags: ['Config'],
            summary: 'Update configuration entries',
            description: 'Batch-updates configuration key-value pairs. Superuser only.',
            security: [{ BearerAuth: [] }],
            body: {
                type: 'object',
                required: ['updates'],
                properties: {
                    updates: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: ['key', 'value'],
                            properties: {
                                original_key: { type: 'string' },
                                key: { type: 'string' },
                                value: { type: 'string' },
                            },
                        },
                    },
                },
                example: {
                    updates: [
                        { key: "telemetry_interval_ms", value: "1000" }
                    ]
                }
            },
            response: {
                200: {
                    type: 'object',
                    properties: {
                        success: { type: 'boolean' },
                        reloaded: { type: 'boolean' },
                    },
                },
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
        const { updates } = request.body;
        if (!updates || !Array.isArray(updates)) {
            return reply.status(400).send({ error: 'Invalid payload: updates must be an array' });
        }
        try {
            const result = await config_service_1.configService.update(updates, user.id);
            // Bust the system endpoints cache so the next fetch picks up any changes
            rebuildSystemEndpointsCache();
            if (result.mqttNeedsReload) {
                mqtt_service_1.mqttService.reload().catch(err => request.log.error(err, 'Failed to reload MQTT service'));
            }
            return { success: true, reloaded: true };
        }
        catch (err) {
            request.log.error(err);
            return reply.status(500).send({ error: 'Failed to update configuration' });
        }
    });
}
