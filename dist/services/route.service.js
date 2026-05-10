"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeService = exports.RouteService = void 0;
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const device_service_1 = require("./device.service");
const session_service_1 = require("./session.service");
const log_service_1 = require("./log.service");
class RouteService {
    supabase;
    /**
     * In-memory active route per device.
     * Populated on dispatch, cleared on completion/abort.
     * Used for fast telemetry transition checks.
     */
    activeRoutes = new Map();
    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
    }
    // ── Dispatch ─────────────────────────────────────────────────
    /**
     * Start a route on a device.
     * Preconditions checked in order — fail fast.
     */
    async dispatch(routeId, userId) {
        // 1. Fetch route and validate ownership + status
        const { data: route, error: fetchErr } = await this.supabase
            .from('routes')
            .select('*')
            .eq('id', routeId)
            .single();
        if (fetchErr || !route) {
            throw { statusCode: 404, message: 'Route not found' };
        }
        if (route.created_by !== userId) {
            throw { statusCode: 403, message: 'Not the owner of this route' };
        }
        if (route.status !== 'draft' && route.status !== 'aborted') {
            throw { statusCode: 409, message: `Route status is '${route.status}', must be 'draft' or 'aborted'` };
        }
        // 2. No conflicting active route on this device (DB query — low frequency)
        const { data: activeRoutes, error: activeErr } = await this.supabase
            .from('routes')
            .select('id')
            .eq('device_id', route.device_id)
            .eq('status', 'active');
        if (activeErr) {
            console.error('RouteService: Failed to check active routes:', activeErr);
            throw activeErr;
        }
        if (activeRoutes && activeRoutes.length > 0) {
            throw { statusCode: 409, message: 'Device already has an active route' };
        }
        // 3. Active session must exist in memory
        if (!session_service_1.sessionService.isOwner(userId, route.device_id)) {
            throw { statusCode: 403, message: 'No active session on this device. Open a session first.' };
        }
        // ── All preconditions passed — commit ────────────────────
        const now = new Date().toISOString();
        // Write status to DB
        const { data: updated, error: updateErr } = await this.supabase
            .from('routes')
            .update({
            status: 'active',
            dispatched_at: now,
        })
            .eq('id', routeId)
            .select('*')
            .single();
        if (updateErr) {
            console.error('RouteService: Failed to update route status:', updateErr);
            throw updateErr;
        }
        // Update in-memory desired + publish
        device_service_1.deviceService.publishRoute(route.device_id, 'start', route.waypoints);
        // Track active route in memory for telemetry completion detection
        this.activeRoutes.set(route.device_id, {
            routeId,
            prevAutopilotActive: null,
        });
        console.log(`🗺️ RouteService: Dispatched route ${routeId} on device ${route.device_id}`);
        log_service_1.logService.info('mobile', 'route', `Dispatched route ${route.name}`, { routeId, deviceId: route.device_id });
        return updated;
    }
    // ── Stop / Abort ─────────────────────────────────────────────
    /**
     * Abort an active route.
     * Resets desired to idle, publishes stop, updates DB.
     */
    async abort(routeId, userId) {
        const { data: route, error: fetchErr } = await this.supabase
            .from('routes')
            .select('*')
            .eq('id', routeId)
            .single();
        if (fetchErr || !route) {
            throw { statusCode: 404, message: 'Route not found' };
        }
        if (route.created_by !== userId) {
            throw { statusCode: 403, message: 'Not the owner of this route' };
        }
        if (route.status !== 'active') {
            throw { statusCode: 409, message: 'Route is not active' };
        }
        // Update DB
        await this.supabase
            .from('routes')
            .update({ status: 'aborted' })
            .eq('id', routeId);
        // Reset desired + publish stop
        device_service_1.deviceService.publishRoute(route.device_id, 'stop');
        // Clear in-memory tracking
        this.activeRoutes.delete(route.device_id);
        console.log(`🗺️ RouteService: Aborted route ${routeId} on device ${route.device_id}`);
        log_service_1.logService.warn('mobile', 'route', `Aborted route ${route.name}`, { routeId, deviceId: route.device_id });
    }
    // ── Telemetry completion detection ───────────────────────────
    /**
     * Called synchronously from TelemetryService on every telemetry frame.
     * Detects autopilot_active true→false transition while a route is active.
     * The actual DB write is async — this method stays synchronous.
     */
    onTelemetry(deviceId, reported) {
        const tracked = this.activeRoutes.get(deviceId);
        if (!tracked)
            return; // No active route on this device
        const currentAutopilotActive = reported.autopilot_active;
        if (currentAutopilotActive === undefined)
            return; //  Field not present
        const current = Boolean(currentAutopilotActive);
        const prev = tracked.prevAutopilotActive;
        // Update tracking state
        tracked.prevAutopilotActive = current;
        // Detect true → false transition
        if (prev === true && current === false) {
            console.log(`🗺️ RouteService: autopilot_active went false for device ${deviceId} — completing route ${tracked.routeId}`);
            log_service_1.logService.info('system', 'route', `Autopilot deactivated on device — completing route`, { routeId: tracked.routeId, deviceId });
            const routeId = tracked.routeId;
            // Clear in-memory tracking first
            this.activeRoutes.delete(deviceId);
            // Reset desired to idle
            device_service_1.deviceService.resetDesired(deviceId);
            // Async DB write — fire and forget
            this.supabase
                .from('routes')
                .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
            })
                .eq('id', routeId)
                .then(({ error }) => {
                if (error) {
                    console.error(`RouteService: Failed to mark route ${routeId} as completed:`, error);
                }
            });
        }
    }
    // ── CRUD (DB) ────────────────────────────────────────────────
    /**
     * Create a new route (draft status).
     */
    async create(deviceId, userId, name, waypoints) {
        const { data, error } = await this.supabase
            .from('routes')
            .insert({
            device_id: deviceId,
            created_by: userId,
            name,
            waypoints,
            status: 'draft',
        })
            .select('*')
            .single();
        if (error) {
            console.error('RouteService: Failed to create route:', error);
            throw error;
        }
        return data;
    }
    /**
     * Get a route by ID.
     */
    async getById(routeId) {
        const { data, error } = await this.supabase
            .from('routes')
            .select('*')
            .eq('id', routeId)
            .single();
        if (error) {
            if (error.code === 'PGRST116')
                return null;
            throw error;
        }
        return data;
    }
    /**
     * List routes with optional filters and pagination.
     */
    async list(filters, pagination) {
        let query = this.supabase
            .from('routes')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false });
        if (filters?.device_id) {
            query = query.eq('device_id', filters.device_id);
        }
        if (filters?.status) {
            query = query.eq('status', filters.status);
        }
        const limit = pagination?.limit || 50;
        const offset = pagination?.offset || 0;
        query = query.range(offset, offset + limit - 1);
        const { data, count, error } = await query;
        if (error) {
            console.error('RouteService: Failed to list routes:', error);
            throw error;
        }
        return {
            data: data || [],
            count: count || 0
        };
    }
    /**
     * Delete a route. Only if status is 'draft'.
     */
    async deleteDraft(routeId, userId) {
        const { data: route, error: fetchErr } = await this.supabase
            .from('routes')
            .select('*')
            .eq('id', routeId)
            .single();
        if (fetchErr || !route) {
            throw { statusCode: 404, message: 'Route not found' };
        }
        if (route.created_by !== userId) {
            throw { statusCode: 403, message: 'Not the owner of this route' };
        }
        if (route.status !== 'draft') {
            throw { statusCode: 409, message: 'Only draft routes can be deleted' };
        }
        await this.supabase
            .from('routes')
            .delete()
            .eq('id', routeId);
    }
}
exports.RouteService = RouteService;
exports.routeService = new RouteService();
