"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.mqttService = exports.MqttService = void 0;
const mqtt_1 = __importDefault(require("mqtt"));
const events_1 = require("events");
const config_service_1 = require("./config.service");
const log_service_1 = require("./log.service");
/**
 * MqttService — Infrastructure wrapper around MQTT.js.
 *
 * Reads broker address/port and topic names from ConfigService.
 * Authenticates using env-level credentials (MQTT_USERNAME / MQTT_PASSWORD).
 * Reconnects with exponential backoff (1s → 30s ceiling).
 * Re-subscribes to all topics on reconnect.
 * Emits device_online / device_offline signals.
 *
 * The server is the sole legitimate MQTT publisher to command topics.
 */
// Known config keys from the config table
const KEY_BROKER_HOST = 'mqtt_broker_host';
const KEY_BROKER_PORT = 'mqtt_broker_port';
const KEY_TOPIC_JOYSTICK = 'mqtt_topic_joystick';
const KEY_TOPIC_ROUTE = 'mqtt_topic_route';
const KEY_TOPIC_STATUS = 'mqtt_topic_status';
const KEY_TOPIC_CAMERA = 'mqtt_topic_camera';
class MqttService extends events_1.EventEmitter {
    client = null;
    subscribeTopics = [];
    messageHandler = null;
    // Backoff state
    reconnectAttempts = 0;
    BACKOFF_BASE_MS = 1000;
    BACKOFF_CEILING_MS = 30000;
    // Topic cache — populated from ConfigService at connect()
    topicJoystick = '';
    topicRoute = '';
    topicStatus = '';
    topicCamera = '';
    /**
     * Connect to the MQTT broker.
     * Must be called AFTER configService.load() has completed.
     */
    async connect() {
        // Read runtime config
        const host = config_service_1.configService.get(KEY_BROKER_HOST);
        const port = config_service_1.configService.get(KEY_BROKER_PORT);
        if (!host || !port) {
            throw new Error(`MqttService: Missing broker config. Ensure "${KEY_BROKER_HOST}" and "${KEY_BROKER_PORT}" exist in the config table.`);
        }
        // Cache topic names
        this.topicJoystick = config_service_1.configService.get(KEY_TOPIC_JOYSTICK) || 'spedi/vehicle/joystick';
        this.topicRoute = config_service_1.configService.get(KEY_TOPIC_ROUTE) || 'spedi/vehicle/route';
        this.topicStatus = config_service_1.configService.get(KEY_TOPIC_STATUS) || 'spedi/vehicle/status';
        this.topicCamera = config_service_1.configService.get(KEY_TOPIC_CAMERA) || 'spedi/vehicle/camera';
        // Topics the server subscribes to (read-only per ACL)
        this.subscribeTopics = [this.topicStatus, this.topicCamera];
        // Connection credentials from environment (connection-level secrets)
        const username = process.env.MQTT_USERNAME || 'server';
        const password = process.env.MQTT_PASSWORD || '';
        const brokerUrl = `mqtt://${host}:${port}`;
        const options = {
            username,
            password,
            clientId: `spedi-server-${Date.now()}`,
            clean: true,
            // Disable mqtt.js built-in reconnect — we handle it manually
            // for controlled exponential backoff with ceiling
            reconnectPeriod: 0,
            connectTimeout: 10000,
        };
        console.log(`🔌 MqttService: Connecting to ${brokerUrl}...`);
        return new Promise((resolve, reject) => {
            this.client = mqtt_1.default.connect(brokerUrl, options);
            this.client.on('connect', () => {
                this.reconnectAttempts = 0;
                log_service_1.logService.info('system', 'connection', `Connected to MQTT broker: ${host}:${port}`);
                console.log(`✅ MqttService: Connected to ${brokerUrl}`);
                this.subscribeAll();
                this.emit('device_online');
                resolve();
            });
            this.client.on('message', (topic, payload) => {
                if (this.messageHandler) {
                    this.messageHandler(topic, payload);
                }
            });
            this.client.on('close', () => {
                log_service_1.logService.warn('system', 'connection', 'MQTT Connection closed. Will attempt reconnect.');
                console.warn('⚠️ MqttService: Connection closed.');
                this.emit('device_offline');
                this.scheduleReconnect(brokerUrl, options);
            });
            this.client.on('error', (err) => {
                log_service_1.logService.error('system', 'connection', 'MQTT Connection error', { error: err.message });
                console.error('❌ MqttService: Connection error:', err.message);
                // Don't reject after initial connect succeeds
            });
            // Timeout for first connect
            setTimeout(() => {
                if (!this.client?.connected) {
                    const msg = `MqttService: Initial connection to ${brokerUrl} timed out. Proceeding anyway.`;
                    console.warn(`⚠️ ${msg}`);
                    resolve(); // Resolve anyway so the server can start without MQTT
                }
            }, 3000);
        });
    }
    /**
     * Register the handler that receives all incoming MQTT messages.
     * Typically TelemetryService.ingest().
     */
    onMessage(handler) {
        this.messageHandler = handler;
    }
    /**
     * Publish a joystick command. QoS 0 — fire and forget, zero awaits.
     * This is the hot path. No database, no validation beyond what the caller does.
     */
    publishJoystick(payload) {
        if (!this.client?.connected) {
            console.warn('MqttService: Cannot publish joystick — not connected.');
            return;
        }
        this.client.publish(this.topicJoystick, JSON.stringify(payload), { qos: 0 });
    }
    /**
     * Publish a route command. QoS 1 — at-least-once delivery.
     * Route dispatch is infrequent and must arrive reliably.
     */
    publishRoute(action, waypoints) {
        if (!this.client?.connected) {
            console.warn('MqttService: Cannot publish route — not connected.');
            return;
        }
        const message = JSON.stringify({ action, waypoints: waypoints || [] });
        this.client.publish(this.topicRoute, message, { qos: 1 });
    }
    /**
     * Generic publish for any topic. Used by higher-level services
     * when they need to send non-standard messages.
     */
    publish(topic, message, qos = 0) {
        if (!this.client?.connected) {
            console.warn(`MqttService: Cannot publish to ${topic} — not connected.`);
            return;
        }
        this.client.publish(topic, message, { qos });
    }
    /**
     * Getter for cached topic names — other services read these
     * without needing to know the config keys.
     */
    get topics() {
        return {
            joystick: this.topicJoystick,
            route: this.topicRoute,
            status: this.topicStatus,
        };
    }
    /**
     * Whether the MQTT client is currently connected.
     */
    get isConnected() {
        return this.client?.connected ?? false;
    }
    /**
     * Graceful shutdown. Called on server close.
     */
    async disconnect() {
        if (this.client) {
            return new Promise((resolve) => {
                this.client.end(false, {}, () => {
                    console.log('🔌 MqttService: Disconnected.');
                    resolve();
                });
            });
        }
    }
    /**
     * Hot-reload: reconnect with new config values.
     * Called by ConfigService when MQTT-related keys change via PUT /config.
     */
    async reload() {
        console.log('🔄 MqttService: Reloading with new config...');
        await this.disconnect();
        this.reconnectAttempts = 0;
        await this.connect();
    }
    // ── Private ──────────────────────────────────────────────────
    subscribeAll() {
        if (!this.client?.connected || this.subscribeTopics.length === 0)
            return;
        this.client.subscribe(this.subscribeTopics, { qos: 1 }, (err, granted) => {
            if (err) {
                console.error('❌ MqttService: Subscribe failed:', err.message);
                return;
            }
            const topics = granted?.map((g) => g.topic).join(', ') || 'none';
            console.log(`📡 MqttService: Subscribed to [${topics}]`);
        });
    }
    /**
     * Exponential backoff reconnect: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
     */
    scheduleReconnect(brokerUrl, options) {
        const delay = Math.min(this.BACKOFF_BASE_MS * Math.pow(2, this.reconnectAttempts), this.BACKOFF_CEILING_MS);
        this.reconnectAttempts++;
        console.log(`🔄 MqttService: Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);
        setTimeout(() => {
            if (this.client) {
                this.client.removeAllListeners();
                this.client.end(true);
            }
            this.client = mqtt_1.default.connect(brokerUrl, options);
            this.client.on('connect', () => {
                this.reconnectAttempts = 0;
                console.log(`✅ MqttService: Reconnected to ${brokerUrl}`);
                this.subscribeAll();
                this.emit('device_online');
            });
            this.client.on('message', (topic, payload) => {
                if (this.messageHandler) {
                    this.messageHandler(topic, payload);
                }
            });
            this.client.on('close', () => {
                console.warn('⚠️ MqttService: Connection lost again.');
                this.emit('device_offline');
                this.scheduleReconnect(brokerUrl, options);
            });
            this.client.on('error', (err) => {
                console.error('❌ MqttService: Reconnect error:', err.message);
            });
        }, delay);
    }
}
exports.MqttService = MqttService;
exports.mqttService = new MqttService();
