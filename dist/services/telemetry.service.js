"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.telemetryService = exports.TelemetryService = void 0;
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const device_service_1 = require("./device.service");
const config_service_1 = require("./config.service");
const log_service_1 = require("./log.service");
/**
 * TelemetryService — Ingestion pipeline for device MQTT payloads.
 *
 * On message:
 *   1. DeviceService.updateReported — sync, in-memory
 *   2. RouteService.onTelemetry — sync, in-memory (stub until RouteService exists)
 *   3. SSE broadcast — sync, fire/forget (stub until SSE is implemented)
 *   4. DB insert raw telemetry — async, not awaited
 *   5. Device last_seen_at update — async, not awaited
 *
 * Tolerant reader: never rejects payloads due to unexpected fields.
 * The full raw JSON is stored verbatim in telemetry.raw (jsonb).
 */
class TelemetryService {
    supabase;
    // Callback hooks — set by other services during init
    routeHandler = null;
    sseHandler = null;
    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
    }
    /**
     * Register RouteService's onTelemetry handler.
     * Called once during server init when RouteService is ready.
     */
    onRoute(handler) {
        this.routeHandler = handler;
    }
    /**
     * Register SSE broadcast handler.
     * Called once during server init when SSE is ready.
     */
    onSSE(handler) {
        this.sseHandler = handler;
    }
    /**
     * Primary ingestion method — called by MqttService on every incoming message.
     *
     * Topic format expected: the status topic (e.g. "spedi/vehicle/status").
     * Device ID resolution: for MVP with one device, we resolve from the
     * topic or use a lookup. Currently uses mqtt_client_id from the payload
     * or falls back to resolving from registered devices.
     *
     * @param topic   The MQTT topic the message arrived on
     * @param payload The raw Buffer from MQTT
     */
    ingest(topic, payload) {
        // ── Size guard ───────────────────────────────────────────
        const maxBytes = parseInt(config_service_1.configService.get('telemetry_max_payload_bytes') || '4096', 10);
        if (payload.length > maxBytes) {
            log_service_1.logService.warn('arduino', 'telemetry', `Payload too large, dropping (${payload.length} bytes)`, { topic, limit: maxBytes });
            console.warn(`TelemetryService: Payload too large (${payload.length} bytes > ${maxBytes} limit), dropping.`, { topic });
            return;
        }
        // ── Parse ────────────────────────────────────────────────
        let parsed;
        try {
            parsed = JSON.parse(payload.toString());
        }
        catch {
            log_service_1.logService.error('arduino', 'telemetry', 'Received non-JSON payload, dropping', { topic });
            console.warn('TelemetryService: Received non-JSON payload, dropping.', {
                topic,
                raw: payload.toString().substring(0, 200),
            });
            return;
        }
        // Resolve device ID — MVP: extract from payload or use hardcoded lookup.
        // The device includes mqtt_client_id or device_id in its payload,
        // or we derive it from the topic structure.
        const deviceId = this.resolveDeviceId(topic, parsed);
        if (!deviceId) {
            log_service_1.logService.warn('arduino', 'telemetry', 'Could not resolve device ID from telemetry payload', { topic });
            console.warn('TelemetryService: Could not resolve device ID, dropping.', { topic });
            return;
        }
        log_service_1.logService.info('arduino', 'telemetry', 'Ingested device telemetry', { deviceId });
        // ── Synchronous pipeline (in-memory, zero DB) ────────────
        // 1. Update reported state in DeviceService shadow
        device_service_1.deviceService.updateReported(deviceId, parsed);
        // 2. Notify RouteService (if registered) — for route completion detection
        if (this.routeHandler) {
            try {
                this.routeHandler(deviceId, parsed);
            }
            catch (err) {
                console.error('TelemetryService: RouteService.onTelemetry threw:', err);
            }
        }
        // 3. Broadcast to SSE clients (if registered)
        if (this.sseHandler) {
            try {
                this.sseHandler(deviceId, parsed);
            }
            catch (err) {
                console.error('TelemetryService: SSE broadcast threw:', err);
            }
        }
        // ── Async operations (fire-and-forget, not awaited) ──────
        // 4. Persist raw telemetry to DB
        this.persistTelemetry(deviceId, parsed);
        // 5. Update device last_seen_at
        device_service_1.deviceService.updateLastSeen(deviceId);
    }
    // ── Private ──────────────────────────────────────────────────
    /**
     * Resolve device ID from topic or payload.
     * MVP strategy: single device. The device_id is looked up from registered
     * devices by mqtt_client_id if present in payload, or derived from topic.
     *
     * For multi-device future: topic would include device ID segment
     * (e.g. spedi/vehicle/{device_id}/status) or payload would carry it.
     */
    resolveDeviceId(topic, parsed) {
        // Prefer explicit device_id in payload
        if (parsed.device_id && typeof parsed.device_id === 'string') {
            return parsed.device_id;
        }
        // Fallback: extract from topic segments if structured as .../device_id/...
        const segments = topic.split('/');
        // For "spedi/vehicle/status" — no device segment in MVP topic structure.
        // In MVP with one device, we use a well-known placeholder.
        // This will be replaced when topic structure includes device_id.
        if (segments.length >= 3) {
            // Check if there's a 4th segment that could be a device ID
            if (segments.length >= 4) {
                return segments[2]; // e.g. spedi/vehicle/{device_id}/status
            }
        }
        // MVP fallback: if only one device exists, we can use 'default'.
        // Higher-level services should register the device mapping.
        // For now, return a stable key so the shadow is consistent.
        return 'default';
    }
    /**
     * Persist telemetry to the database. Async, fire-and-forget.
     * Tolerant reader: stores full raw payload as-is, no field validation.
     */
    persistTelemetry(deviceId, raw) {
        this.supabase
            .from('telemetry')
            .insert({
            device_id: deviceId,
            recorded_at: new Date().toISOString(),
            raw,
        })
            .then(({ error }) => {
            if (error) {
                console.error(`TelemetryService: DB insert failed for device ${deviceId}:`, error);
            }
        });
    }
}
exports.TelemetryService = TelemetryService;
exports.telemetryService = new TelemetryService();
