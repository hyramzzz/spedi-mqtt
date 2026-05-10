import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';

import crypto from 'crypto';

export interface AuthenticatedUser {
    id: string;
    email: string;
    is_superuser: boolean;
}

export class AuthService {
    private supabase: SupabaseClient;
    private jwtPublicKey: string | null = null;
    private publicKeyPromise: Promise<string | null> | null = null;

    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';

        this.supabase = createClient(supabaseUrl, supabaseKey);
    }

    /**
     * Lazy load the public key from the Supabase JWKS endpoint.
     */
    private async getPublicKey(): Promise<string | null> {
        if (this.jwtPublicKey) return this.jwtPublicKey;

        if (!this.publicKeyPromise) {
            this.publicKeyPromise = (async () => {
                const url = `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
                try {
                    const res = await fetch(url);
                    const jwks = await res.json();
                    const key = jwks.keys.find((k: any) => k.use === 'sig' && k.alg === 'ES256');
                    if (key) {
                        const publicKey = crypto.createPublicKey({ key, format: 'jwk' });
                        this.jwtPublicKey = publicKey.export({ type: 'spki', format: 'pem' }) as string;
                        console.log('✅ Supabase ES256 Public Key loaded successfully');
                        return this.jwtPublicKey;
                    }
                } catch (err) {
                    console.error('Failed to fetch JWKS from Supabase:', err);
                }
                return null;
            })();
        }
        return this.publicKeyPromise;
    }

    async login(email: string, password: string) {
        const { data, error } = await this.supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;
        return data;
    }

    async logout() {
        const { error } = await this.supabase.auth.signOut();
        if (error) throw error;
    }

    /**
     * Verifies a JWT locally using the fetched Supabase Public Key.
     */
    async verifyToken(token: string): Promise<AuthenticatedUser | null> {
        const pubKey = await this.getPublicKey();
        if (!pubKey) {
            console.error('Cannot verify token: Supabase Public Key is not loaded.');
            return null;
        }

        try {
            const decoded = jwt.verify(token, pubKey, { algorithms: ['ES256'] }) as any;
            return {
                id: decoded.sub,
                email: decoded.email,
                is_superuser: decoded.app_metadata?.is_superuser === true,
            };
        } catch (err) {
            console.warn('Local JWT verification failed:', err);
            return null;
        }
    }
}

export const authService = new AuthService();
