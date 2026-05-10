import 'dotenv/config';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import cors from '@fastify/cors';
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import configRoutes from './routes/config';
import deviceRoutes from './routes/devices';
import authPlugin from './plugins/auth.plugin';

import { createClient } from '@supabase/supabase-js';

const fastify = Fastify({
    logger: true,
    ajv: {
        customOptions: {
            strict: false
        }
    }
});

// CORS — explicitly allow localhost for Flutter Web debug, Vercel, and Railway
fastify.register(cors, {
    origin: (origin, cb) => {
        // Always allow requests with no origin (like mobile devices, Postman, etc.)
        if (!origin) {
            cb(null, true);
            return;
        }

        // Explicitly allow localhost, 127.0.0.1, Vercel, and Railway
        const allowedPatterns = [/^https?:\/\/localhost:\d+$/, /^https?:\/\/127\.0\.0\.1:\d+$/, /\.vercel\.app$/, /\.railway\.app$/];
        if (allowedPatterns.some(pattern => pattern.test(origin))) {
            cb(null, true);
            return;
        }

        // Fallback: reflect the origin (same as origin: true)
        cb(null, true);
    },
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

const supabase = createClient(supabaseUrl, supabaseKey);

import { configService } from './services/config.service';
import { mqttService } from './services/mqtt.service';
import { deviceService } from './services/device.service';
import { sessionService } from './services/session.service';
import { telemetryService } from './services/telemetry.service';
import { sseService } from './services/sse.service';
import { cameraService } from './services/camera.service';
import { logService } from './services/log.service';
import realtimeRoutes from './routes/realtime';
import controlRoutes from './routes/control';
import sessionRoutes from './routes/session';
import routeRoutes from './routes/routes';
import telemetryRoutes from './routes/telemetry';
import debugRoutes from './routes/debug';
import userRoutes from './routes/users';
import cameraRoutes from './routes/camera';
import { routeService } from './services/route.service';

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
        } catch (err: any) {
            err.statusCode = 400;
            err.code = 'FST_ERR_CTP_INVALID_JSON_BODY';
            done(err, undefined);
        }
    });
    payload.on('error', err => done(err, undefined));
});

// Register plugins
fastify.register(authPlugin);
fastify.register(websocket);

// Register OpenAPI spec
import swagger from '@fastify/swagger';
fastify.register(swagger, {
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
    const spec = fastify.swagger() as any;

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
    if (statusCode === 404 && !request.url.startsWith('/api') && !request.url.startsWith('/devices')) return;

    const msg = `HTTP ${statusCode}: ${request.method} ${request.url} - ${error.message}`;
    logService.error('system', 'connection', msg, {
        name: error.name,
        code: error.code
    });
});

// Register routes
fastify.register(healthRoutes);
fastify.register(authRoutes);
fastify.register(configRoutes);
fastify.register(deviceRoutes);
fastify.register(realtimeRoutes);
fastify.register(controlRoutes);
fastify.register(sessionRoutes);
fastify.register(routeRoutes);
fastify.register(telemetryRoutes);
fastify.register(debugRoutes);
fastify.register(userRoutes);
fastify.register(cameraRoutes);

const start = async () => {
    try {
        // 1. ConfigService loads from DB
        fastify.log.info('Validating Supabase connection...');
        await configService.load();
        fastify.log.info('Supabase connection verified and config loaded.');

        // 2. Resolve MVP device ID for anonymous telemetry mapping
        await telemetryService.init();

        // 3. Inject MqttService into DeviceService (avoids circular imports)
        deviceService.init(mqttService);

        // 3. Inject MQTT stop publisher into SessionService
        sessionService.init(() => {
            mqttService.publishJoystick({ throttle: 0, steering: 0 });
        });

        // 4. Close orphaned sessions from previous run
        await sessionService.closeOrphaned();

        // Wire SSE to Telemetry ingestion
        telemetryService.onSSE((deviceId, payload) => {
            sseService.broadcast({
                type: 'telemetry',
                deviceId,
                payload
            });
        });

        // Wire RouteService completion detection to telemetry pipeline
        telemetryService.onRoute((deviceId, reported) => {
            routeService.onTelemetry(deviceId, reported);
        });

        // Wire SSE and Logger to MQTT device connection events
        mqttService.on('device_online', (deviceId) => {
            logService.info('arduino', 'connection', 'Device (Arduino) reconnected to MQTT broker');
            sseService.broadcast({
                type: 'device_online',
                deviceId,
                payload: { status: 'online', timestamp: new Date().toISOString() }
            });
        });

        mqttService.on('device_offline', (deviceId) => {
            logService.warn('arduino', 'connection', 'Device (Arduino) disconnected from MQTT broker');
            sseService.broadcast({
                type: 'device_offline',
                deviceId,
                payload: { status: 'offline', timestamp: new Date().toISOString() }
            });
        });

        // 5. Wire SSE to Session change events
        sessionService.on('session_change', (deviceId, session) => {
            sseService.broadcast({
                type: 'session_change',
                deviceId,
                payload: session // session is ActiveSession | null
            });
        });

        // 6. MQTTClient connects (after config is available)
        fastify.log.info('Connecting to MQTT broker...');
        mqttService.onMessage((topic, payload) => {
            if (topic === mqttService.topicCamera) {
                cameraService.ingest(topic, payload);
            } else {
                telemetryService.ingest(topic, payload);
            }
        });
        mqttService.connect().catch(e => fastify.log.warn('MQTT connection failed on startup, will retry.'));
        fastify.log.info('MQTT broker connection initiated.');

        // 7. HTTP server starts accepting
        const port = Number(process.env.PORT) || 3000;
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// Graceful shutdown
const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    await mqttService.disconnect();
    await fastify.close();
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();

