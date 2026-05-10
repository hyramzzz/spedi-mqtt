import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logService } from './log.service';

export interface ConfigRow {
    id: number;
    key: string;
    value: string;
    description: string | null;
    updated_at: string;
    updated_by: string | null;
}

export class ConfigService {
    private supabase: SupabaseClient;
    private configMap: Map<string, ConfigRow> = new Map();

    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    /**
     * Loads all config rows from the database into the in-memory map.
     */
    async load(): Promise<void> {
        const { data, error } = await this.supabase
            .from('config')
            .select('*');

        if (error) {
            console.error('Failed to load configuration from database:', error);
            throw error;
        }

        this.configMap.clear();
        for (const row of data || []) {
            this.configMap.set(row.key, row as ConfigRow);
        }
        console.log(`✅ ConfigService: Loaded ${this.configMap.size} rows into memory.`);
    }

    /**
     * Synchronously retrieves a configuration value by key.
     */
    get(key: string): string | undefined {
        return this.configMap.get(key)?.value;
    }

    /**
     * Updates multiple configuration keys in both the database and memory.
     * Note: Hot-reload notifications are deferred to Phase 8.
     */
    async update(updates: { original_key?: string; key: string; value: string }[], userId: string): Promise<{ mqttNeedsReload: boolean }> {
        let mqttNeedsReload = false;

        for (const { original_key, key, value } of updates) {
            // Drop old key if renaming
            if (original_key && original_key !== key) {
                await this.supabase.from('config').delete().eq('key', original_key);
                this.configMap.delete(original_key);
                if (original_key.startsWith('mqtt_')) mqttNeedsReload = true;
            }

            if (key.startsWith('mqtt_')) mqttNeedsReload = true;

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
                this.configMap.set(key, data as ConfigRow);
            }
        }
        console.log(`✅ ConfigService: Updated ${updates.length} keys by user ${userId}.`);
        logService.info('system', 'config', `Configuration updated (${updates.length} keys)`, { keys: updates.map(u => u.key) });

        return { mqttNeedsReload };
    }

    /**
     * Returns all configuration rows as an array.
     */
    getAll(): ConfigRow[] {
        return Array.from(this.configMap.values());
    }
}

export const configService = new ConfigService();
