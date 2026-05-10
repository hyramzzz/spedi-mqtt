'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RiRobot2Line, RiLoader4Line, RiErrorWarningLine } from '@remixicon/react';
import { loginDirect } from '@/lib/auth-store';

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        try {
            await loginDirect(email, password);
            router.push('/');
        } catch (err: any) {
            setError(err.message || 'An unexpected error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full bg-background text-foreground flex flex-col items-center justify-center p-4 lg:p-6 selection:bg-foreground selection:text-background font-mono">

            <div className="w-full max-w-sm relative z-10 border border-border bg-background p-6 rounded-sm">
                <div className="flex flex-col gap-1 mb-6 border-b border-border pb-4">
                    <div className="flex items-center gap-2 text-foreground mb-2">
                        <RiRobot2Line size={18} />
                        <h1 className="text-sm font-bold tracking-widest uppercase font-sans">SPEDI_CONSOLE</h1>
                    </div>
                    <p className="text-[10px] text-muted-foreground uppercase font-sans tracking-widest">Provide credentials to access</p>
                </div>

                <form onSubmit={handleLogin} className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans">Email Address</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-background border border-border rounded-sm px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground transition-all"
                            required
                            autoFocus
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans">Security Key</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-background border border-border rounded-sm px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground focus:ring-1 focus:ring-foreground transition-all"
                            required
                        />
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 text-[10px] text-background bg-foreground border border-foreground p-2 rounded-sm mt-2 uppercase tracking-wide font-bold">
                            <RiErrorWarningLine size={14} />
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="mt-4 flex items-center justify-center gap-2 rounded-sm bg-foreground px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest text-background hover:bg-muted hover:text-foreground border border-foreground transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? <RiLoader4Line className="animate-spin" size={14} /> : "Authenticate >>"}
                    </button>
                </form>
            </div>

            <p className="mt-8 text-[10px] text-muted-foreground z-10 uppercase tracking-widest font-sans">Unauthorized access is strictly prohibited || AC_LOGGED</p>
        </div>
    );
}
