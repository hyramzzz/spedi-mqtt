'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { RiLoader4Line } from '@remixicon/react';
import { getCurrentUser, logoutDirect, setToken } from '@/lib/auth-store';
import { Sidebar } from './sidebar';
import { SseProvider } from './sse-context';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<{ email: string; is_superuser: boolean } | null>(null);
    const router = useRouter();
    const pathname = usePathname();

    const isLogin = pathname === '/login';

    useEffect(() => {
        if (isLogin) {
            setLoading(false);
            return;
        }

        const checkAuth = async () => {
            try {
                const userData = await getCurrentUser();
                if (!userData) throw new Error('Not authenticated');
                setUser(userData);

                // RBAC: If not superuser, only allow /docs
                const restrictedPaths = ['/', '/devices', '/config', '/users'];
                if (!userData.is_superuser && restrictedPaths.includes(pathname)) {
                    console.log('RBAC: Non-superuser redirected to /docs');
                    router.push('/docs');
                }
            } catch (err) {
                console.error('Auth verification failed:', err);
                setToken(null);
                router.push('/login');
            } finally {
                setLoading(false);
            }
        };

        checkAuth();
    }, [router, isLogin]);

    const handleLogout = async () => {
        try {
            await logoutDirect();
        } catch (err) {
            console.error('Logout failed:', err);
            setToken(null);
        } finally {
            router.push('/login');
        }
    };

    if (loading) {
        return (
            <div className="w-full h-screen bg-background flex flex-col gap-4 items-center justify-center text-muted-foreground">
                <RiLoader4Line className="animate-spin" size={24} />
                <p className="text-[10px] uppercase font-mono tracking-widest">SYS_INIT :: VERIFY_CREDENTIALS</p>
            </div>
        );
    }

    if (isLogin) {
        return <>{children}</>;
    }

    return (
        <div className="flex w-full h-screen bg-background text-foreground font-mono selection:bg-foreground selection:text-background flex-row">
            <Sidebar user={user} onLogout={handleLogout} />
            <main className="flex-1 overflow-y-auto">
                <SseProvider>
                    {children}
                </SseProvider>
            </main>
        </div>
    );
}
