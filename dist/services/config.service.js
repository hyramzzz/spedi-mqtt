"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configService = exports.ConfigService = void 0;
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const log_service_1 = require("./log.service");
class ConfigService {
    supabase;
    configMap = new Map();
    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
    }
    /**
     * Loads all config rows from the database into the in-memory map.
     */
    async load() {
        const { data, error } = await this.supabase
            .from('config')
            .select('*');
        if (error) {
            console.error('Failed to load configuration from database:', error);
            throw error;
        }
        this.configMap.clear();
        for (const row of data || []) {
            this.configMap.set(row.key, row);
        }
        console.log(`✅ ConfigService: Loaded ${this.configMap.size} rows into memory.`);
    }
    /**
     * Synchronously retrieves a configuration value by key.
     */
    get(key) {
        return this.configMap.get(key)?.value;
    }
    /**
     * Updates multiple configuration keys in both the database and memory.
     * Note: Hot-reload notifications are deferred to Phase 8.
     */
    async update(updates, userId) {
        let mqttNeedsReload = false;
        for (const { original_key, key, value } of updates) {
            // Drop old key if renaming
            if (original_key && original_key !== key) {
                await this.supabase.from('config').delete().eq('key', original_key);
                this.configMap.delete(original_key);
                if (original_key.startsWith('mqtt_'))
                    mqttNeedsReload = true;
            }
            if (key.startsWith('mqtt_'))
                mqttNeedsReload = true;
            const payload = {
                key,
                value,
                updated_by: userId,
                updated_at: new Date().toISOString()
            };
            // Upsert into DB
            const { data, error } = await this.supabase
                .from('config')
                .upsert(payload, { onConflict: 'key' })
                .select()
                .single();
            if (error) {
                console.error(`Failed to update config key "${key}":`, error);
                throw error;
            }
            // Update memory with the fresh row from DB
            if (data) {
                this.configMap.set(key, data);
            }
        }
        console.log(`✅ ConfigService: Updated ${updates.length} keys by user ${userId}.`);
        log_service_1.logService.info('system', 'config', `Configuration updated (${updates.length} keys)`, { keys: updates.map(u => u.key) });
        return { mqttNeedsReload };
    }
    /**
     * Returns all configuration rows as an array.
     */
    getAll() {
        return Array.from(this.configMap.values());
    }
}
exports.ConfigService = ConfigService;
exports.configService = new ConfigService();
