"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.AuthService = void 0;
require("dotenv/config");
const supabase_js_1 = require("@supabase/supabase-js");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
class AuthService {
    supabase;
    jwtPublicKey = null;
    publicKeyPromise = null;
    constructor() {
        const supabaseUrl = process.env.SUPABASE_URL || '';
        const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
        this.supabase = (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey);
    }
    /**
     * Lazy load the public key from the Supabase JWKS endpoint.
     */
    async getPublicKey() {
        if (this.jwtPublicKey)
            return this.jwtPublicKey;
        if (!this.publicKeyPromise) {
            this.publicKeyPromise = (async () => {
                const url = `${process.env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
                try {
                    const res = await fetch(url);
                    const jwks = await res.json();
                    const key = jwks.keys.find((k) => k.use === 'sig' && k.alg === 'ES256');
                    if (key) {
                        const publicKey = crypto_1.default.createPublicKey({ key, format: 'jwk' });
                        this.jwtPublicKey = publicKey.export({ type: 'spki', format: 'pem' });
                        console.log('✅ Supabase ES256 Public Key loaded successfully');
                        return this.jwtPublicKey;
                    }
                }
                catch (err) {
                    console.error('Failed to fetch JWKS from Supabase:', err);
                }
                return null;
            })();
        }
        return this.publicKeyPromise;
    }
    async login(email, password) {
        const { data, error } = await this.supabase.auth.signInWithPassword({
            email,
            password,
        });
        if (error)
            throw error;
        return data;
    }
    async logout() {
        const { error } = await this.supabase.auth.signOut();
        if (error)
            throw error;
    }
    /**
     * Verifies a JWT locally using the fetched Supabase Public Key.
     */
    async verifyToken(token) {
        const pubKey = await this.getPublicKey();
        if (!pubKey) {
            console.error('Cannot verify token: Supabase Public Key is not loaded.');
            return null;
        }
        try {
            const decoded = jsonwebtoken_1.default.verify(token, pubKey, { algorithms: ['ES256'] });
            return {
                id: decoded.sub,
                email: decoded.email,
                is_superuser: decoded.app_metadata?.is_superuser === true,
            };
        }
        catch (err) {
            console.warn('Local JWT verification failed:', err);
            return null;
        }
    }
}
exports.AuthService = AuthService;
exports.authService = new AuthService();
