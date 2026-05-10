"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deviceService = exports.DeviceService = void 0;
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const config_service_1 = require("./config.service");
const log_service_1 = require("./log.service");
class DeviceService {
    supabase;
    /**
     * In-memory shadow map. Keyed by device ID.
     * Authoritative — all shadow reads are sync memory operations.
     */
    shadows = new Map();
    /**
     * Lazy reference to MqttService.
     * Injected via init() to avoid circular imports
     * (TelemetryService imports DeviceService; server.ts imports both).
     */
    mqtt = null;
    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
    }
    /**
     * Inject MqttService reference at init time.
     * Called once in server.ts after both singletons are created.
     */
    init(mqtt) {
        this.mqtt = mqtt;
    }
    // ── Shadow Operations (synchronous, in-memory) ──────────────
    /**
     * Get all device IDs that currently have an active shadow in memory.
     * Useful for flushing state to new dashboard clients, even for devices
     * not persisted in the database (e.g. emulator 'default' device).
     */
    getActiveShadowDeviceIds() {
        return Array.from(this.shadows.keys());
    }
    /**
     * Get or create the shadow for a device.
     * Lazily initializes with idle defaults on first access.
     */
    getOrCreateShadow(deviceId) {
        let shadow = this.shadows.get(deviceId);
        if (!shadow) {
            shadow = {
                desired: {
                    mode: 'idle',
                    throttle: 0,
                    steering: 0,
                    route: null,
                },
                reported: {},
            };
            this.shadows.set(deviceId, shadow);
        }
        return shadow;
    }
    /**
     * Update the reported side of the shadow from an incoming telemetry payload.
     *
     * If `telemetry_field_map` is configured, it controls which device keys
     * are extracted and what shadow keys they map to. Format:
     *   { "device_payload_key": "shadow_key", ... }
     *
     * If no mapping is configured, ALL payload keys merge directly into
     * the shadow (full passthrough — tolerant reader default).
     */
    updateReported(deviceId, payload) {
        const shadow = this.getOrCreateShadow(deviceId);
        const mappingRaw = config_service_1.configService.get('telemetry_field_map');
        if (mappingRaw) {
            try {
                const map = JSON.parse(mappingRaw);
                for (const [deviceKey, shadowKey] of Object.entries(map)) {
                    if (payload[deviceKey] !== undefined) {
                        shadow.reported[shadowKey] = payload[deviceKey];
                    }
                }
            }
            catch {
                // Malformed mapping — fall back to passthrough
                Object.assign(shadow.reported, payload);
            }
        }
        else {
            // No mapping configured — passthrough all keys
            Object.assign(shadow.reported, payload);
        }
    }
    /**
     * Update desired state (partial merge).
     * Synchronous — zero DB, zero await.
     */
    setDesired(deviceId, partial) {
        const shadow = this.getOrCreateShadow(deviceId);
        shadow.desired = { ...shadow.desired, ...partial };
    }
    /**
     * Reset desired state to idle defaults.
     * Used on session close and disconnect timeout.
     * Synchronous — zero DB, zero await.
     */
    resetDesired(deviceId) {
        const shadow = this.getOrCreateShadow(deviceId);
        shadow.desired = {
            mode: 'idle',
            throttle: 0,
            steering: 0,
            route: null,
        };
    }
    // ── Publish Operations (fire-and-forget, zero await) ────────
    /**
     * Publish a joystick command to the device.
     * Updates desired in-memory and publishes via MQTT.
     * QoS 0, no callback, no await — this is the hot path.
     */
    publishJoystick(deviceId, payload) {
        this.setDesired(deviceId, { throttle: payload.throttle, steering: payload.steering });
        if (this.mqtt) {
            this.mqtt.publishJoystick(payload);
        }
        // No logService call here — this is the hot path.
        // Logging every frame (5/sec continuous) floods the 200-slot syslog buffer.
    }
    /**
     * Publish a route command to the device.
     * Updates desired in-memory and publishes via MQTT.
     * QoS 1 for reliable delivery — routes are infrequent.
     */
    publishRoute(deviceId, action, waypoints) {
        if (action === 'start' && waypoints) {
            this.setDesired(deviceId, { mode: 'auto', route: waypoints });
            log_service_1.logService.info('mobile', 'route', `Autonomous route dispatched (${waypoints.length} wpts)`);
        }
        else if (action === 'stop') {
            this.resetDesired(deviceId);
            log_service_1.logService.info('mobile', 'route', 'Route execution aborted by user');
        }
        if (this.mqtt) {
            this.mqtt.publishRoute(action, waypoints);
        }
    }
    /**
     * Returns the full shadow state including a computed delta.
     * Delta contains desired keys whose values differ from reported.
     */
    getState(deviceId) {
        const shadow = this.getOrCreateShadow(deviceId);
        // Compute delta: desired keys that differ from reported
        const delta = {};
        const reportedRecord = shadow.reported;
        for (const key of Object.keys(shadow.desired)) {
            const desiredVal = shadow.desired[key];
            const reportedVal = reportedRecord[key];
            if (JSON.stringify(desiredVal) !== JSON.stringify(reportedVal)) {
                delta[key] = { desired: desiredVal, reported: reportedVal };
            }
        }
        return {
            desired: { ...shadow.desired },
            reported: { ...shadow.reported },
            delta,
        };
    }
    /**
     * Read reported state directly (for command gating checks).
     * Returns empty object if no shadow exists.
     */
    getReported(deviceId) {
        return this.shadows.get(deviceId)?.reported ?? {};
    }
    // ── DB Operations (async) ───────────────────────────────────
    /**
     * Lists all devices in the system.
     */
    async listDevices() {
        const { data, error } = await this.supabase
            .from('devices')
            .select('*');
        if (error) {
            console.error('Failed to list devices:', error);
            throw error;
        }
        return data || [];
    }
    /**
     * Retrieves a single device by ID.
     */
    async getDeviceById(id) {
        const { data, error } = await this.supabase
            .from('devices')
            .select('*')
            .eq('id', id)
            .single();
        if (error) {
            if (error.code === 'PGRST116')
                return null; // Not found
            console.error(`Failed to get device ${id}:`, error);
            throw error;
        }
        return data;
    }
    /**
     * Registers a new device.
     */
    async registerDevice(name, mqttClientId, ownerId) {
        const { data, error } = await this.supabase
            .from('devices')
            .insert({
            name,
            mqtt_client_id: mqttClientId,
            owner_id: ownerId
        })
            .select()
            .single();
        if (error) {
            console.error('Failed to register device:', error);
            throw error;
        }
        return data;
    }
    /**
     * Updates an existing device.
     */
    async updateDevice(id, name, mqttClientId) {
        const payload = {};
        if (name !== undefined)
            payload.name = name;
        if (mqttClientId !== undefined)
            payload.mqtt_client_id = mqttClientId;
        const { data, error } = await this.supabase
            .from('devices')
            .update(payload)
            .eq('id', id)
            .select()
            .single();
        if (error) {
            console.error(`Failed to update device ${id}:`, error);
            throw error;
        }
        return data;
    }
    /**
     * Updates last_seen_at for a device. Async, fire-and-forget.
     */
    updateLastSeen(deviceId) {
        this.supabase
            .from('devices')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('id', deviceId)
            .then(({ error }) => {
            if (error) {
                console.error(`Failed to update last_seen_at for ${deviceId}:`, error);
            }
        });
    }
    /**
     * Deletes a device by ID. Removes from DB and clears in-memory shadow.
     */
    async deleteDevice(deviceId) {
        const { error } = await this.supabase
            .from('devices')
            .delete()
            .eq('id', deviceId);
        if (error) {
            console.error(`Failed to delete device ${deviceId}:`, error);
            throw error;
        }
        this.shadows.delete(deviceId);
    }
}
exports.DeviceService = DeviceService;
exports.deviceService = new DeviceService();
