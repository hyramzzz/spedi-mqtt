'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    RiDashboardLine,
    RiRouteLine,
    RiSettings4Line,
    RiBookmarkLine,
    RiLogoutBoxRLine,
    RiRobot2Line,
    RiServerLine,
    RiUserLine
} from '@remixicon/react';
import { SessionIndicator } from './session-indicator';

interface SidebarProps {
    user: { email: string; is_superuser: boolean } | null;
    onLogout: () => void;
}

export function Sidebar({ user, onLogout }: SidebarProps) {
    const pathname = usePathname();

    const navItems = [
        { name: 'DASHBOARD', href: '/', icon: RiDashboardLine, superuser: true },
        { name: 'DEVICES', href: '/devices', icon: RiServerLine, superuser: true },
        { name: 'USERS', href: '/users', icon: RiUserLine, superuser: true },
        { name: 'CONFIG', href: '/config', icon: RiSettings4Line, superuser: true },
        { name: 'DOCS', href: '/docs', icon: RiBookmarkLine },
    ];

    return (
        <aside className="w-64 border-r border-border bg-background flex flex-col h-screen overflow-y-auto">
            {/* Header / Logo */}
            <div className="p-4 border-b border-border flex items-center gap-2">
                <div className="bg-foreground text-background p-1.5 rounded-sm">
                    <RiRobot2Line size={16} />
                </div>
                <span className="font-bold tracking-widest uppercase font-sans text-foreground text-sm">SPEDI_OS</span>
            </div>

            {/* Navigation Menu */}
            <nav className="flex-1 p-3 flex flex-col gap-1">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans px-3 mb-2 mt-2">MENU</p>
                {navItems.map((item) => {
                    if (item.superuser && !user?.is_superuser) return null;
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`flex items-center gap-3 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-widest font-sans transition-colors ${isActive
                                ? 'bg-foreground text-background shadow-[0_0_0_1px_theme(colors.foreground)]'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                                }`}
                        >
                            <item.icon size={16} />
                            {item.name}
                        </Link>
                    );
                })}
            </nav>

            {/* User & Settings & Logout */}
            <div className="mt-auto p-4 border-t border-border flex flex-col gap-3">
                <div className="p-3 border border-border bg-muted/30 rounded-sm">
                    {user ? (
                        <div className="flex flex-col gap-1">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans">CURRENT_USER</span>
                            <span className="text-xs font-mono text-foreground break-all">{user.email}</span>
                            {user.is_superuser && (
                                <span className="text-[9px] mt-1 font-bold tracking-widest uppercase bg-foreground text-background px-1.5 py-0.5 rounded-sm self-start">Superuser</span>
                            )}
                        </div>
                    ) : (
                        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans">NOT_AUTHENTICATED</div>
                    )}
                </div>

                <SessionIndicator />

                <button
                    onClick={onLogout}
                    className="flex items-center justify-center gap-2 w-full text-foreground hover:bg-foreground hover:text-background border border-foreground p-2 rounded-sm transition-colors text-xs font-bold uppercase tracking-widest font-sans mt-2"
                >
                    <RiLogoutBoxRLine size={14} />
                    SYS_EXIT
                </button>
            </div>
        </aside>
    );
}
