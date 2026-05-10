'use client';

import { useEffect, useState, useCallback } from 'react';
import { RiLoader4Line, RiSave3Line, RiCloseLine, RiEdit2Line, RiCheckLine, RiLockLine, RiRefreshLine, RiServerLine } from "@remixicon/react";
import { apiFetch } from '@/lib/api';

interface ConfigRow {
    id: number;
    key: string;
    value: string;
    description: string | null;
    updated_at: string;
    updated_by: string | null;
}

interface SystemEndpoint {
    label: string;
    value: string;
}

// ── Hardcoded Fallback Defaults ───────────────────────────────────────
// If the API call fails or the backend hasn't deployed yet,
// these values keep the config page functional.
const FALLBACK_ENDPOINTS: SystemEndpoint[] = [
    { label: 'REST API Base', value: 'https://spedi-core-production-8104.up.railway.app' },
    { label: 'SSE Event Stream', value: 'https://spedi-core-production-8104.up.railway.app/events?token=<JWT>' },
    { label: 'WebSocket Control', value: 'wss://spedi-core-production-8104.up.railway.app/control?token=<JWT>' },
    { label: 'MQTT Public Proxy', value: 'metro.proxy.rlwy.net : 41220' },
    { label: 'MQTT Internal (Railway)', value: 'spedi-mqtt.railway.internal : 1883' },
    { label: 'MQTT Device Creds', value: 'device : spedi2026' },
    { label: 'MQTT Server Creds', value: 'server : spedi2026' },
];

const FALLBACK_IMMUTABLE_KEYS = ['mqtt_broker_host', 'mqtt_broker_port'];

export default function ConfigManager() {
    const [configData, setConfigData] = useState<ConfigRow[]>([]);
    const [immutableKeys, setImmutableKeys] = useState<string[]>(FALLBACK_IMMUTABLE_KEYS);
    const [systemEndpoints, setSystemEndpoints] = useState<SystemEndpoint[]>(FALLBACK_ENDPOINTS);
    const [editingKey, setEditingKey] = useState<string | null>(null);
    const [editKeyString, setEditKeyString] = useState<string>('');
    const [editValue, setEditValue] = useState<string>('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const fetchAll = useCallback(async () => {
        try {
            setRefreshing(true);
            const res = await apiFetch('/config');
            if (!res.ok) throw new Error('Failed to fetch config');

            const data = await res.json();

            // Handle both old response shape (array) and new shape (object)
            if (Array.isArray(data)) {
                // Legacy: backend returns raw array
                setConfigData(data);
            } else {
                setConfigData(data.config || []);
                if (data.immutableKeys) setImmutableKeys(data.immutableKeys);
                if (data.endpoints && data.endpoints.length > 0) {
                    setSystemEndpoints(data.endpoints);
                }
            }
        } catch (err) {
            console.error('Failed to load config:', err);
            setError('Failed to fetch configuration data. Showing cached defaults.');
        } finally {
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const handleEditStart = (row: ConfigRow) => {
        setEditingKey(row.key);
        setEditKeyString(row.key);
        setEditValue(row.value);
        setError(null);
    };

    const handleEditCancel = () => {
        setEditingKey(null);
        setEditKeyString('');
        setEditValue('');
        setError(null);
    };

    const handleSave = async (original_key: string) => {
        setSaving(true);
        setError(null);
        setSuccess(null);
        try {
            const res = await apiFetch('/config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ updates: [{ original_key, key: editKeyString, value: editValue }] })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'Failed to save configuration');
            }

            // Update local state with the saved value and fresh timestamp
            setConfigData(prev => prev.map(row =>
                row.key === original_key
                    ? { ...row, key: editKeyString, value: editValue, updated_at: new Date().toISOString() }
                    : row
            ));

            setEditingKey(null);
            setSuccess('Configuration saved. The backend is reloading to apply changes; this may take a few seconds.');

            // Re-fetch to pick up refreshed system endpoints
            fetchAll();

            // Auto-hide success message after 5 seconds
            setTimeout(() => {
                setSuccess(null);
            }, 5000);

        } catch (err: any) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const isImmutable = (key: string) => immutableKeys.includes(key);

    return (
        <div className="p-4 lg:p-6 flex flex-col gap-4 h-full overflow-y-auto">
            <div className="border-b border-border pb-4 flex items-end justify-between">
                <div>
                    <h1 className="text-lg font-bold tracking-widest uppercase font-sans text-foreground">System_Configuration //</h1>
                    <p className="text-[10px] text-muted-foreground mt-1 uppercase font-sans tracking-widest">Manage global system parameters and environmental settings.</p>
                </div>
                <button
                    onClick={fetchAll}
                    disabled={refreshing}
                    className="p-1.5 text-muted-foreground hover:text-foreground rounded-sm transition-colors disabled:opacity-50 border border-border"
                    title="Refresh All"
                >
                    <RiRefreshLine size={14} className={refreshing ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <div className="rounded-sm bg-foreground text-background border border-foreground p-3 text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 font-sans">
                    <RiCloseLine size={16} />
                    {error}
                </div>
            )}

            {success && (
                <div className="rounded-sm bg-background text-foreground border border-foreground p-3 text-[10px] uppercase font-sans tracking-widest flex items-center gap-2">
                    <RiCheckLine size={16} />
                    {success}
                </div>
            )}

            {/* ── System Endpoints (Immutable & Grouped) ────────────────── */}
            <div className="rounded-sm border border-border bg-background">
                <div className="px-4 py-3 border-b border-border flex items-center justify-start gap-2 bg-muted/30 w-full">
                    <RiServerLine size={14} className="text-muted-foreground mr-1" />
                    <span className="text-[10px] font-bold text-foreground uppercase tracking-widest font-sans text-left">System Infrastructure</span>
                    <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-sans ml-1 text-left">// Deployment Constants</span>
                </div>
                <div className="divide-y divide-border/50">
                    {/* API INFRASTRUCTURE GROUP */}
                    <div className="px-4 py-2 bg-muted/10">
                        <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-[0.2em]">01_API_INFRASTRUCTURE</span>
                    </div>
                    {systemEndpoints.slice(0, 3).map((ep) => (
                        <div key={ep.label} className="flex items-center px-4 py-2.5 group hover:bg-muted/30 transition-colors">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans w-56 flex-shrink-0">{ep.label}</span>
                            <span className="text-[11px] font-mono text-foreground/80 text-left break-all select-all flex-1">{ep.value}</span>
                            <RiLockLine size={12} className="text-muted-foreground/20 ml-3 flex-shrink-0" />
                        </div>
                    ))}

                    {/* MQTT CONNECTIVITY GROUP */}
                    <div className="px-4 py-2 bg-muted/10 border-t border-border/50">
                        <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-[0.2em]">02_MQTT_CONNECTIVITY</span>
                    </div>
                    {systemEndpoints.slice(3, 5).map((ep) => (
                        <div key={ep.label} className="flex items-center px-4 py-2.5 group hover:bg-muted/30 transition-colors">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans w-56 flex-shrink-0">{ep.label}</span>
                            <span className="text-[11px] font-mono text-foreground/80 text-left break-all select-all flex-1">{ep.value}</span>
                            <RiLockLine size={12} className="text-muted-foreground/20 ml-3 flex-shrink-0" />
                        </div>
                    ))}

                    {/* ACCESS CREDENTIALS GROUP */}
                    <div className="px-4 py-2 bg-muted/10 border-t border-border/50">
                        <span className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-[0.2em]">03_ACCESS_CREDENTIALS</span>
                    </div>
                    {systemEndpoints.slice(5).map((ep) => (
                        <div key={ep.label} className="flex items-center px-4 py-2.5 group hover:bg-muted/30 transition-colors">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest font-sans w-56 flex-shrink-0">{ep.label}</span>
                            <span className="text-[11px] font-mono text-foreground/80 text-left break-all select-all flex-1">{ep.value}</span>
                            <RiLockLine size={12} className="text-muted-foreground/20 ml-3 flex-shrink-0" />
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Mutable Configuration Table ──────────────────────────────── */}
            <div className="rounded-sm border border-border bg-background flex-1 flex flex-col">
                <div className="overflow-x-auto rounded-sm">
                    <table className="w-full text-left text-xs">
                        <thead className="bg-muted/30 text-foreground text-[10px] uppercase tracking-widest font-sans border-b border-border">
                            <tr>
                                <th className="px-4 py-3 font-bold">Key</th>
                                <th className="px-4 py-3 font-bold">Value</th>
                                <th className="px-4 py-3 font-bold">Description</th>
                                <th className="px-4 py-3 font-bold">Last Updated</th>
                                <th className="px-4 py-3 font-bold text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {configData.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground uppercase tracking-widest font-sans text-[10px]">
                                        {refreshing ? 'Loading configuration...' : 'No configuration keys found.'}
                                    </td>
                                </tr>
                            ) : (
                                configData.map((row) => {
                                    const locked = isImmutable(row.key);
                                    return (
                                        <tr key={row.key} className={`transition-colors group ${locked ? 'opacity-60' : 'hover:bg-muted/50'}`}>
                                            <td className="px-4 py-3 font-mono text-foreground font-bold whitespace-nowrap">
                                                {editingKey === row.key ? (
                                                    <input
                                                        type="text"
                                                        value={editKeyString}
                                                        onChange={(e) => setEditKeyString(e.target.value)}
                                                        className="w-full bg-background border border-foreground rounded-sm px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                                                        disabled={saving}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleSave(row.key);
                                                            if (e.key === 'Escape') handleEditCancel();
                                                        }}
                                                    />
                                                ) : (
                                                    <span className="flex items-center gap-1.5">
                                                        {row.key}
                                                        {locked && <RiLockLine size={11} className="text-muted-foreground/40" />}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-mono max-w-xs truncate">
                                                {editingKey === row.key ? (
                                                    <input
                                                        type="text"
                                                        value={editValue}
                                                        onChange={(e) => setEditValue(e.target.value)}
                                                        className="w-full bg-background border border-foreground rounded-sm px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-foreground"
                                                        autoFocus
                                                        disabled={saving}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') handleSave(row.key);
                                                            if (e.key === 'Escape') handleEditCancel();
                                                        }}
                                                    />
                                                ) : (
                                                    <span className="text-muted-foreground">{row.value}</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground text-[10px] uppercase font-sans tracking-wide max-w-sm">
                                                {row.description || <span className="italic opacity-50">NULL</span>}
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground text-[10px] uppercase font-sans tracking-widest whitespace-nowrap">
                                                {new Date(row.updated_at).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {locked ? (
                                                    <span className="text-[10px] text-muted-foreground/40 uppercase tracking-widest font-sans">Locked</span>
                                                ) : editingKey === row.key ? (
                                                    <div className="flex items-center justify-end gap-2">
                                                        <button
                                                            onClick={() => handleSave(row.key)}
                                                            disabled={saving}
                                                            className="p-1 text-background bg-foreground hover:bg-muted-foreground rounded-sm transition-colors disabled:opacity-50 border border-foreground"
                                                            title="Save"
                                                        >
                                                            {saving ? <RiLoader4Line className="animate-spin" size={16} /> : <RiSave3Line size={16} />}
                                                        </button>
                                                        <button
                                                            onClick={handleEditCancel}
                                                            disabled={saving}
                                                            className="p-1 text-foreground hover:text-background hover:bg-foreground rounded-sm transition-colors disabled:opacity-50 border border-border"
                                                            title="Cancel"
                                                        >
                                                            <RiCloseLine size={16} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => handleEditStart(row)}
                                                        className="p-1 text-muted-foreground hover:text-foreground bg-transparent rounded-sm transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                                        title="Edit Value"
                                                    >
                                                        <RiEdit2Line size={16} />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
