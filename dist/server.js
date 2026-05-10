"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fastify_1 = __importDefault(require("fastify"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const cors_1 = __importDefault(require("@fastify/cors"));
const health_1 = __importDefault(require("./routes/health"));
const auth_1 = __importDefault(require("./routes/auth"));
const config_1 = __importDefault(require("./routes/config"));
const devices_1 = __importDefault(require("./routes/devices"));
const auth_plugin_1 = __importDefault(require("./plugins/auth.plugin"));
const supabase_js_1 = require("@supabase/supabase-js");
const fastify = (0, fastify_1.default)({
    logger: true,
    ajv: {
        customOptions: {
            strict: false
        }
    }
});
// CORS — allow all origins (reflects requester) for Flutter Web and development
fastify.register(cors_1.default, {
    origin: true,
    credentials: true,
    methods: 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    strictPreflight: false,
});
// Configure Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
if (!supabaseUrl || !supabaseKey) {
    fastify.log.error('FATAL: SUPABASE_URL and SUPABASE_ANON_KEY must be provided');
    process.exit(1);
}
const supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
const config_service_1 = require("./services/config.service");
const mqtt_service_1 = require("./services/mqtt.service");
const device_service_1 = require("./services/device.service");
const session_service_1 = require("./services/session.service");
const telemetry_service_1 = require("./services/telemetry.service");
const sse_service_1 = require("./services/sse.service");
const camera_service_1 = require("./services/camera.service");
const log_service_1 = require("./services/log.service");
const realtime_1 = __importDefault(require("./routes/realtime"));
const control_1 = __importDefault(require("./routes/control"));
const session_1 = __importDefault(require("./routes/session"));
const routes_1 = __importDefault(require("./routes/routes"));
const telemetry_1 = __importDefault(require("./routes/telemetry"));
const debug_1 = __importDefault(require("./routes/debug"));
const users_1 = __importDefault(require("./routes/users"));
const camera_1 = __importDefault(require("./routes/camera"));
const route_service_1 = require("./services/route.service");
// Intercept application/json to safely handle empty bodies natively without crashing Fastify.
fastify.removeContentTypeParser('application/json');
fastify.addContentTypeParser('application/json', function (req, payload, done) {
    let rawBody = '';
    payload.on('data', chunk => {
        rawBody += chunk.toString();
    });
    payload.on('end', () => {
        if (!rawBody || rawBody.trim() === '') {
            done(null, {}); // Tolerate empty body as empty object
            return;
        }
        try {
            const json = JSON.parse(rawBody);
            done(null, json);
        }
        catch (err) {
            err.statusCode = 400;
            err.code = 'FST_ERR_CTP_INVALID_JSON_BODY';
            done(err, undefined);
        }
    });
    payload.on('error', err => done(err, undefined));
});
// Register plugins
fastify.register(auth_plugin_1.default);
fastify.register(websocket_1.default);
// Register OpenAPI spec
const swagger_1 = __importDefault(require("@fastify/swagger"));
fastify.register(swagger_1.default, {
    openapi: {
        info: {
            title: 'SPEDI Platform API //',
            description: 'IoT orchestration backend for the SPEDI autonomous vehicle system. Refer to the Integration Guides tab for architecture, data flow, and client-specific documentation.',
            version: '1.0.6',
        },
        components: {
            securitySchemes: {
                BearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Supabase JWT obtained via POST /auth/login',
                },
            },
        },
        tags: [
            { name: 'Auth', description: 'JWT issuance, logout, and profile retrieval.' },
            { name: 'Devices', description: 'Device registry and in-memory Shadow State management.' },
            { name: 'Telemetry', description: 'Historical telemetry query with cursor-based pagination.' },
            { name: 'Users', description: 'Standard account CRUD. Superuser promotion is restricted to direct DB access.' },
            { name: 'Sessions', description: 'Device control mutex. One session per user, one per device.' },
            { name: 'Routes', description: 'Autonomous route lifecycle: draft, dispatch, abort, complete.' },
            { name: 'Config', description: 'Runtime parameters with hot-reload on MQTT-related changes.' },
            { name: 'Realtime', description: 'SSE event stream and WebSocket joystick control.' },
            { name: 'Debug', description: 'Telemetry mock injector for platform simulation.' },
            { name: 'System', description: 'Health check and diagnostics.' },
            { name: 'Camera', description: 'Latest ESP32-CAM snapshot retrieval.' },
        ],
        servers: [],
    }
});
// Expose spec at GET /openapi.json
fastify.get('/openapi.json', { schema: { hide: true } }, async () => {
    const spec = fastify.swagger();
    if (spec && spec.paths) {
        // Pass 1: Strip OPTIONS methods and trailing-slash duplicates
        for (const path in spec.paths) {
            if (spec.paths[path].options) {
                delete spec.paths[path].options;
            }
            if (path.endsWith('/') && path.length > 1) {
                const canonical = path.slice(0, -1);
                if (spec.paths[canonical]) {
                    delete spec.paths[path];
                }
            }
        }
        // Pass 2: Remove any path objects that have zero remaining HTTP methods
        for (const path in spec.paths) {
            const methods = Object.keys(spec.paths[path]);
            // OpenAPI path items can have non-method keys like 'parameters', 'summary', etc.
            const httpMethods = methods.filter(m => ['get', 'post', 'put', 'delete', 'patch', 'head', 'trace'].includes(m));
            if (httpMethods.length === 0) {
                delete spec.paths[path];
            }
        }
    }
    // Force empty servers block to prevent Scalar fallback
    if (spec) {
        spec.servers = [];
    }
    return spec;
});
// Broadcast all unhandled or API errors to the dashboard
fastify.addHook('onError', async (request, reply, error) => {
    const statusCode = reply.statusCode || 500;
    // Don't broadcast 404s for favicon or maps which are spammy, but broadcast real API errors
    if (statusCode === 404 && !request.url.startsWith('/api') && !request.url.startsWith('/devices'))
        return;
    const msg = `HTTP ${statusCode}: ${request.method} ${request.url} - ${error.message}`;
    log_service_1.logService.error('system', 'connection', msg, {
        name: error.name,
        code: error.code
    });
});
// Register routes
fastify.register(health_1.default);
fastify.register(auth_1.default);
fastify.register(config_1.default);
fastify.register(devices_1.default);
fastify.register(realtime_1.default);
fastify.register(control_1.default);
fastify.register(session_1.default);
fastify.register(routes_1.default);
fastify.register(telemetry_1.default);
fastify.register(debug_1.default);
fastify.register(users_1.default);
fastify.register(camera_1.default);
const start = async () => {
    try {
        // 1. ConfigService loads from DB
        fastify.log.info('Validating Supabase connection...');
        await config_service_1.configService.load();
        fastify.log.info('Supabase connection verified and config loaded.');
        // 2. Inject MqttService into DeviceService (avoids circular imports)
        device_service_1.deviceService.init(mqtt_service_1.mqttService);
        // 3. Inject MQTT stop publisher into SessionService
        session_service_1.sessionService.init(() => {
            mqtt_service_1.mqttService.publishJoystick({ throttle: 0, steering: 0 });
        });
        // 4. Close orphaned sessions from previous run
        await session_service_1.sessionService.closeOrphaned();
        // Wire SSE to Telemetry ingestion
        telemetry_service_1.telemetryService.onSSE((deviceId, payload) => {
            sse_service_1.sseService.broadcast({
                type: 'telemetry',
                deviceId,
                payload
            });
        });
        // Wire RouteService completion detection to telemetry pipeline
        telemetry_service_1.telemetryService.onRoute((deviceId, reported) => {
            route_service_1.routeService.onTelemetry(deviceId, reported);
        });
        // Wire SSE and Logger to MQTT device connection events
        mqtt_service_1.mqttService.on('device_online', (deviceId) => {
            log_service_1.logService.info('arduino', 'connection', 'Device (Arduino) reconnected to MQTT broker');
            sse_service_1.sseService.broadcast({
                type: 'device_online',
                deviceId,
                payload: { status: 'online', timestamp: new Date().toISOString() }
            });
        });
        mqtt_service_1.mqttService.on('device_offline', (deviceId) => {
            log_service_1.logService.warn('arduino', 'connection', 'Device (Arduino) disconnected from MQTT broker');
            sse_service_1.sseService.broadcast({
                type: 'device_offline',
                deviceId,
                payload: { status: 'offline', timestamp: new Date().toISOString() }
            });
        });
        // 5. Wire SSE to Session change events
        session_service_1.sessionService.on('session_change', (deviceId, session) => {
            sse_service_1.sseService.broadcast({
                type: 'session_change',
                deviceId,
                payload: session // session is ActiveSession | null
            });
        });
        // 6. MQTTClient connects (after config is available)
        fastify.log.info('Connecting to MQTT broker...');
        mqtt_service_1.mqttService.onMessage((topic, payload) => {
            if (topic === mqtt_service_1.mqttService.topicCamera) {
                camera_service_1.cameraService.ingest(topic, payload);
            }
            else {
                telemetry_service_1.telemetryService.ingest(topic, payload);
            }
        });
        mqtt_service_1.mqttService.connect().catch(e => fastify.log.warn('MQTT connection failed on startup, will retry.'));
        fastify.log.info('MQTT broker connection initiated.');
        // 7. HTTP server starts accepting
        const port = Number(process.env.PORT) || 3000;
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
// Graceful shutdown
const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    await mqtt_service_1.mqttService.disconnect();
    await fastify.close();
    process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
start();
