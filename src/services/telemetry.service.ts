import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { deviceService } from './device.service';
import { configService } from './config.service';
import { logService } from './log.service';

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

export class TelemetryService {
    private supabase: SupabaseClient;

    // Callback hooks — set by other services during init
    private routeHandler: ((deviceId: string, reported: Record<string, any>) => void) | null = null;
    private sseHandler: ((deviceId: string, payload: Record<string, any>) => void) | null = null;

    /**
     * Cached UUID of the single registered device.
     * Loaded once at startup via init(). Used as fallback when the
     * Arduino payload doesn't include a device_id field (MVP).
     */
    private mvpDeviceId: string | null = null;

    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    /**
     * Load the MVP device ID from the database.
     * Must be called once during server startup (after Supabase is verified)
     * so the synchronous ingest() hot path can resolve anonymous payloads.
     */
    async init(): Promise<void> {
        const { data, error } = await this.supabase
            .from('devices')
            .select('id')
            .limit(1)
            .single();

        if (data && !error) {
            this.mvpDeviceId = data.id;
            console.log(`✅ TelemetryService: MVP device resolved to ${data.id}`);
        } else {
            console.warn('⚠️ TelemetryService: No registered device found. Anonymous telemetry will be dropped until a device is registered.');
        }
    }

    /**
     * Register RouteService's onTelemetry handler.
     * Called once during server init when RouteService is ready.
     */
    onRoute(handler: (deviceId: string, reported: Record<string, any>) => void): void {
        this.routeHandler = handler;
    }

    /**
     * Register SSE broadcast handler.
     * Called once during server init when SSE is ready.
     */
    onSSE(handler: (deviceId: string, payload: Record<string, any>) => void): void {
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
    ingest(topic: string, payload: Buffer): void {
        // ── Size guard ───────────────────────────────────────────
        const maxBytes = parseInt(configService.get('telemetry_max_payload_bytes') || '4096', 10);
        if (payload.length > maxBytes) {
            logService.warn('arduino', 'telemetry', `Payload too large, dropping (${payload.length} bytes)`, { topic, limit: maxBytes });
            console.warn(`TelemetryService: Payload too large (${payload.length} bytes > ${maxBytes} limit), dropping.`, { topic });
            return;
        }

        // ── Parse ────────────────────────────────────────────────
        let parsed: Record<string, any>;
        try {
            parsed = JSON.parse(payload.toString());
        } catch {
            logService.error('arduino', 'telemetry', 'Received non-JSON payload, dropping', { topic });
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
            logService.warn('arduino', 'telemetry', 'Could not resolve device ID from telemetry payload', { topic });
            console.warn('TelemetryService: Could not resolve device ID, dropping.', { topic });
            return;
        }

        logService.info('arduino', 'telemetry', 'Ingested device telemetry', { deviceId });

        // ── Synchronous pipeline (in-memory, zero DB) ────────────

        // 1. Update reported state in DeviceService shadow
        deviceService.updateReported(deviceId, parsed);

        // 2. Notify RouteService (if registered) — for route completion detection
        if (this.routeHandler) {
            try {
                this.routeHandler(deviceId, parsed);
            } catch (err) {
                console.error('TelemetryService: RouteService.onTelemetry threw:', err);
            }
        }

        // 3. Broadcast to SSE clients (if registered)
        if (this.sseHandler) {
            try {
                this.sseHandler(deviceId, parsed);
            } catch (err) {
                console.error('TelemetryService: SSE broadcast threw:', err);
            }
        }

        // ── Async operations (fire-and-forget, not awaited) ──────

        // 4. Persist raw telemetry to DB
        this.persistTelemetry(deviceId, parsed);

        // 5. Update device last_seen_at
        deviceService.updateLastSeen(deviceId);
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
    private resolveDeviceId(topic: string, parsed: Record<string, any>): string | null {
        // Prefer explicit device_id in payload
        if (parsed.device_id && typeof parsed.device_id === 'string') {
            return parsed.device_id;
        }

        // Fallback: extract from topic segments if structured as .../device_id/...
        const segments = topic.split('/');
        if (segments.length >= 4) {
            return segments[2]; // e.g. spedi/vehicle/{device_id}/status
        }

        // MVP fallback: use the cached real device UUID loaded at startup.
        // The Arduino doesn't include device_id in its payload yet,
        // so we map anonymous telemetry to the single registered device.
        if (this.mvpDeviceId) {
            return this.mvpDeviceId;
        }

        return null;
    }

    /**
     * Maximum telemetry rows to retain per device (CCTV-style circular buffer).
     * Once exceeded, the oldest rows are deleted after each insert.
     */
    private readonly MAX_TELEMETRY_ROWS = 100;

    /**
     * Persist telemetry to the database. Async, fire-and-forget.
     * Tolerant reader: stores full raw payload as-is, no field validation.
     *
     * After insert, prunes oldest rows beyond MAX_TELEMETRY_ROWS for this device.
     */
    private persistTelemetry(deviceId: string, raw: Record<string, any>): void {
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
                    return;
                }
                // Prune: keep only the newest MAX_TELEMETRY_ROWS rows for this device
                this.pruneTelemetry(deviceId);
            });
    }

    /**
     * Delete oldest telemetry rows beyond the cap for a given device.
     * Finds the recorded_at cutoff of the Nth newest row, then deletes
     * everything older. Async, fire-and-forget.
     */
    private pruneTelemetry(deviceId: string): void {
        this.supabase
            .from('telemetry')
            .select('recorded_at')
            .eq('device_id', deviceId)
            .order('recorded_at', { ascending: false })
            .range(this.MAX_TELEMETRY_ROWS, this.MAX_TELEMETRY_ROWS)
            .then(({ data, error }) => {
                if (error || !data || data.length === 0) return; // Within cap or error

                const cutoff = data[0].recorded_at;
                this.supabase
                    .from('telemetry')
                    .delete()
                    .eq('device_id', deviceId)
                    .lt('recorded_at', cutoff)
                    .then(({ error: delError }) => {
                        if (delError) {
                            console.error(`TelemetryService: Prune failed for device ${deviceId}:`, delError);
                        }
                    });
            });
    }
}

export const telemetryService = new TelemetryService();
