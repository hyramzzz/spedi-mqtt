import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface UserRecord {
    id: string;
    email: string;
    is_superuser: boolean;
    created_at: string;
}

export class UserService {
    private supabaseAdmin: SupabaseClient;

    private initialized = false;

    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

        if (!supabaseUrl || !serviceRoleKey) {
            console.warn('⚠️ UserService: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing. Admin operations will fail.');
        } else {
            this.initialized = true;
        }

        // Initialize Supabase with service role key for bypass RLS and admin operations.
        // If the key is missing from env, we use a dummy string to prevent the entire node 
        // server from crashing on boot (createClient throws if empty). Operations will just fail gracefully.
        this.supabaseAdmin = createClient(supabaseUrl || 'http://dummy', serviceRoleKey || 'dummy_key_to_prevent_startup_crash', {
            auth: {
                autoRefreshToken: false,
                persistSession: false
            }
        });
    }

    /** Guard: throws actionable error if service role key is not configured. */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error('UserService unavailable: SUPABASE_SERVICE_ROLE_KEY is missing or empty in the server environment. Set it in Railway variables and redeploy.');
        }
    }

    async listUsers(): Promise<UserRecord[]> {
        this.ensureInitialized();

        const { data: { users }, error } = await this.supabaseAdmin.auth.admin.listUsers();
        if (error) throw error;

        return users.map(u => ({
            id: u.id,
            email: u.email || '',
            is_superuser: u.app_metadata?.is_superuser === true,
            created_at: u.created_at
        }));
    }

    async createUser(email: string, password: string): Promise<UserRecord> {
        this.ensureInitialized();

        const { data: { user }, error } = await this.supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            app_metadata: { is_superuser: false } // Force standard user
        });

        if (error) {
            // Surface actionable message for common deployment misconfiguration
            if (error.message?.toLowerCase().includes('invalid api key')) {
                throw new Error('Invalid API key — verify that SUPABASE_SERVICE_ROLE_KEY (not the anon key) is set in the server environment variables.');
            }
            throw error;
        }
        if (!user) throw new Error('User creation failed: No user returned');

        return {
            id: user.id,
            email: user.email || '',
            is_superuser: false,
            created_at: user.created_at
        };
    }

    async updateUser(id: string, data: { email?: string; password?: string }): Promise<void> {
        // We explicitly do NOT allow updating app_metadata here to prevent superuser elevation
        const { error } = await this.supabaseAdmin.auth.admin.updateUserById(id, {
            email: data.email,
            password: data.password
        });

        if (error) throw error;
    }

    async deleteUser(id: string): Promise<void> {
        const { error } = await this.supabaseAdmin.auth.admin.deleteUser(id);
        if (error) throw error;
    }
}

export const userService = new UserService();
