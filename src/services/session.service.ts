import { EventEmitter } from 'events';
import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { deviceService } from './device.service';
import { logService } from './log.service';

/**
 * SessionService — In-memory session mutex with DB persistence.
 *
 * The in-memory map is the source of truth for all hot-path reads.
 * DB writes are async and non-blocking. One active session per device,
 * enforced in-memory before any DB write.
 *
 * Grace period: on WS disconnect, a 30s timer starts. If the client
 * reconnects within the window, the session resumes. If the timer
 * fires, the session is closed with reason 'timeout'.
 */

const GRACE_PERIOD_MS = 30_000;

export interface ActiveSession {
    sessionId: string;
    userId: string;
    deviceId: string;
    connectedAt: string;
}

export class SessionService extends EventEmitter {
    private supabase: SupabaseClient;

    /** One active session per device. Source of truth — memory. */
    private activeByDevice: Map<string, ActiveSession> = new Map();

    /** Reverse lookup: userId → deviceId. One session per user. */
    private activeByUser: Map<string, string> = new Map();

    /** Grace period timers, keyed by deviceId. */
    private graceTimers: Map<string, NodeJS.Timeout> = new Map();

    /** MQTT publish callback — injected to avoid circular imports. */
    private mqttPublishStop: (() => void) | null = null;

    constructor() {
        super();
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    /**
     * Inject MQTT stop publisher at init time.
     * Called once in server.ts after MqttService is available.
     */
    init(mqttPublishStop: () => void): void {
        this.mqttPublishStop = mqttPublishStop;
    }

    // ── Hot-path reads (synchronous, in-memory) ─────────────────

    /** Get the active session for a device. Null if none. */
    getActive(deviceId: string): ActiveSession | null {
        return this.activeByDevice.get(deviceId) ?? null;
    }

    /** Check if this user owns the active session on any device. */
    isActive(userId: string): boolean {
        return this.activeByUser.has(userId);
    }

    /** Check if this user owns the session on the specified device. */
    isOwner(userId: string, deviceId: string): boolean {
        const session = this.activeByDevice.get(deviceId);
        return session !== null && session !== undefined && session.userId === userId;
    }

    /** Get the device ID for a user's active session. Null if none. */
    getDeviceForUser(userId: string): string | null {
        return this.activeByUser.get(userId) ?? null;
    }

    // ── Session lifecycle ────────────────────────────────────────

    /**
     * Open a control session.
     * Checks in-memory map first (409 if claimed by another user).
     * DB write happens only after the in-memory check passes.
     */
    async open(userId: string, deviceId: string): Promise<ActiveSession> {
        // Check if device is already claimed
        const existing = this.activeByDevice.get(deviceId);
        if (existing) {
            if (existing.userId === userId) {
                // Same user — return the existing session
                return existing;
            }
            throw { statusCode: 409, message: 'Device is already claimed by another user' };
        }

        // Check if user already has a session on another device
        const existingDevice = this.activeByUser.get(userId);
        if (existingDevice && existingDevice !== deviceId) {
            throw { statusCode: 409, message: 'User already has an active session on another device' };
        }

        const now = new Date().toISOString();

        // Write to DB first — if this fails, no in-memory state changes
        const { data, error } = await this.supabase
            .from('sessions')
            .insert({
                device_id: deviceId,
                user_id: userId,
                started_at: now,
            })
            .select('id')
            .single();

        if (error) {
            console.error('SessionService: DB insert failed:', error);
            throw error;
        }

        const session: ActiveSession = {
            sessionId: data.id,
            userId,
            deviceId,
            connectedAt: now,
        };

        // Commit to memory only after DB succeeds
        this.activeByDevice.set(deviceId, session);
        this.activeByUser.set(userId, deviceId);

        // Set desired mode to manual
        deviceService.setDesired(deviceId, { mode: 'manual' });

        // Emit change event
        this.emit('session_change', deviceId, session);

        logService.info('mobile', 'session', `Manual control session started on device ${deviceId}`, { userId });

        return session;
    }

    /**
     * Close the active session for a user.
     * Removes from memory immediately, DB write is async.
     */
    close(userId: string, reason: string): void {
        const deviceId = this.activeByUser.get(userId);
        if (!deviceId) return;

        const session = this.activeByDevice.get(deviceId);
        if (!session || session.userId !== userId) return;

        // Clear grace timer if running
        this.cancelGracePeriod(deviceId);

        // Remove from memory immediately
        this.activeByDevice.delete(deviceId);
        this.activeByUser.delete(userId);

        // Reset desired to idle and publish stop
        deviceService.resetDesired(deviceId);
        if (this.mqttPublishStop) {
            this.mqttPublishStop();
        }

        // Emit change event
        this.emit('session_change', deviceId, null);

        logService.info('mobile', 'session', `Manual control session closed on device ${deviceId}`, { userId, reason });

        // Async DB update — fire and forget
        this.supabase
            .from('sessions')
            .update({
                ended_at: new Date().toISOString(),
                end_reason: reason,
            })
            .eq('id', session.sessionId)
            .then(({ error }) => {
                if (error) {
                    console.error(`SessionService: Failed to close session ${session.sessionId} in DB:`, error);
                }
            });
    }

    // ── Grace period ─────────────────────────────────────────────

    /**
     * Start the 30s grace period timer for a device.
     * Called when WS disconnects. If the timer fires, the session closes.
     */
    startGracePeriod(deviceId: string): void {
        // Don't start if already running
        if (this.graceTimers.has(deviceId)) return;

        const session = this.activeByDevice.get(deviceId);
        if (!session) return;

        console.log(`⏱️ SessionService: Grace period started for device ${deviceId} (${GRACE_PERIOD_MS}ms)`);
        logService.warn('system', 'session', `Websocket disconnected. Grace period started for device ${deviceId}`);

        const timer = setTimeout(() => {
            this.graceTimers.delete(deviceId);
            console.log(`⏱️ SessionService: Grace period expired for device ${deviceId} — closing session.`);
            logService.error('system', 'session', `Grace period expired for device ${deviceId} — closing session.`);
            this.close(session.userId, 'timeout');
        }, GRACE_PERIOD_MS);

        this.graceTimers.set(deviceId, timer);
    }

    /**
     * Cancel the grace period for a device.
     * Called when WS reconnects within the window.
     */
    cancelGracePeriod(deviceId: string): void {
        const timer = this.graceTimers.get(deviceId);
        if (timer) {
            clearTimeout(timer);
            this.graceTimers.delete(deviceId);
            console.log(`⏱️ SessionService: Grace period cancelled for device ${deviceId}`);
            logService.info('system', 'session', `Websocket reconnected. Grace period cancelled for device ${deviceId}`);
        }
    }

    // ── Startup cleanup ──────────────────────────────────────────

    /**
     * Close all orphaned sessions in the database.
     * Called once at server startup. Bulk-updates all sessions
     * with ended_at = null to reason 'server_restart'.
     */
    async closeOrphaned(): Promise<void> {
        const { data, error } = await this.supabase
            .from('sessions')
            .update({
                ended_at: new Date().toISOString(),
                end_reason: 'server_restart',
            })
            .is('ended_at', null)
            .select('id');

        if (error) {
            console.error('SessionService: Failed to close orphaned sessions:', error);
            return;
        }

        const count = data?.length ?? 0;
        if (count > 0) {
            console.log(`🧹 SessionService: Closed ${count} orphaned session(s) from previous run.`);
            logService.info('system', 'session', `Closed ${count} orphaned session(s) from previous run.`);
        }
    }
}

export const sessionService = new SessionService();
