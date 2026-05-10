'use client';

import { useState, useCallback } from 'react';
import { RiTerminalBoxLine, RiFilter3Line, RiDeleteBinLine } from '@remixicon/react';
import { useSseEvent } from './sse-context';

export type LogSource = 'arduino' | 'mobile' | 'system';
export type LogLevel = 'info' | 'warn' | 'error';
export type LogType = 'telemetry' | 'connection' | 'auth' | 'route' | 'camera' | 'config' | 'session';

export interface LogEntry {
    id: string;
    timestamp: string;
    source: LogSource;
    level: LogLevel;
    type: LogType;
    message: string;
    data?: any;
}

export function SystemActivity() {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [filter, setFilter] = useState<'all' | LogSource>('all');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

    // Subscribe to syslog events via shared SSE context
    useSseEvent('syslog', useCallback((data: any) => {
        const newLog = data.payload as LogEntry;
        if (!newLog.id) {
            newLog.id = `fallback-id-${Date.now()}-${Math.random()}`;
        }

        setLogs((prev) => {
            if (prev.some((l) => l.id === newLog.id)) return prev;
            return [newLog, ...prev].slice(0, 500);
        });
    }, []));

    const toggleExpand = (id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const clearLogs = () => {
        setLogs([]);
        setExpandedIds(new Set());
    };

    const filteredLogs = logs.filter(l => filter === 'all' || l.source === filter);

    const getSourceColor = (source: LogSource) => {
        switch (source) {
            case 'arduino': return 'text-indigo-400 border-indigo-400/20 bg-indigo-400/10';
            case 'mobile': return 'text-emerald-400 border-emerald-400/20 bg-emerald-400/10';
            case 'system': return 'text-foreground border-border bg-muted/30';
            default: return 'text-muted-foreground border-border bg-muted/30';
        }
    };

    const getLevelIcon = (level: LogLevel) => {
        switch (level) {
            case 'error': return '🔴';
            case 'warn': return '🟡';
            case 'info': return '🟢';
            default: return '⚪';
        }
    };


    return (
        <div className="w-full h-full flex flex-col border border-border bg-background rounded-sm overflow-hidden min-h-[400px]">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border p-3 px-4 bg-muted/30 shrink-0">
                <div className="flex items-center gap-2">
                    <RiTerminalBoxLine size={16} className="text-foreground" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-foreground font-sans">System_Activity //</h3>
                </div>

                <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                    <RiFilter3Line size={12} />
                    <select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as any)}
                        className="bg-background border border-border text-foreground rounded-sm px-2 py-1 pr-6 focus:border-foreground focus:outline-none transition-colors cursor-pointer text-[10px] uppercase font-sans tracking-widest appearance-none"
                        style={{
                            backgroundImage: `url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23fafafa' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e")`,
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 0.25rem center',
                            backgroundSize: '1em'
                        }}
                    >
                        <option value="all" className="bg-background text-foreground">ALL_SOURCES</option>
                        <option value="arduino" className="bg-background text-foreground">ARDUINO_IoT</option>
                        <option value="mobile" className="bg-background text-foreground">MOBILE_APP</option>
                        <option value="system" className="bg-background text-foreground">BACKEND_SYS</option>
                    </select>

                    <button
                        onClick={clearLogs}
                        className="flex items-center gap-1.5 px-2 py-1 bg-background border border-border text-foreground rounded-sm hover:border-foreground transition-colors"
                        title="Clear Logs"
                    >
                        <RiDeleteBinLine size={12} />
                        CLEAR
                    </button>
                </div>
            </div>

            {/* Log Stream */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2 bg-[#0c0c0e]">
                {filteredLogs.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                        Waiting for events...
                    </div>
                ) : (
                    filteredLogs.map(log => (
                        <div key={log.id} className="flex flex-col gap-1 text-[11px] font-mono group">
                            <div
                                className="flex items-start gap-2.5 cursor-pointer hover:bg-white/5 p-1.5 rounded-sm transition-all border border-transparent hover:border-white/10"
                                onClick={() => toggleExpand(log.id)}
                            >
                                <span className="text-muted-foreground whitespace-nowrap opacity-40 group-hover:opacity-70 shrink-0 mt-[2px]">
                                    {new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                                <span className="text-[10px] mt-[3px] opacity-75 shrink-0">{getLevelIcon(log.level || 'info')}</span>
                                <span className={`uppercase tracking-widest px-1.5 py-0.5 rounded-sm border text-[9px] font-sans font-bold shrink-0 mt-[1px] ${getSourceColor(log.source || 'system')}`}>
                                    {(log.source || 'sys').substring(0, 3)}
                                </span>
                                <span className="text-foreground/50 uppercase tracking-wider text-[10px] w-28 shrink-0 mt-[2px] font-mono font-bold truncate">
                                    [{log.type || 'unknown'}]
                                </span>
                                <span className={`text-foreground/90 break-words leading-relaxed mt-[2px] flex-1 ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : ''}`}>
                                    {log.message || 'Empty payload'}
                                </span>
                            </div>

                            {/* Expanded Payload */}
                            {expandedIds.has(log.id) && log.data && (
                                <div className="ml-24 pl-2 border-l-2 border-border/50 bg-black/20 p-2 rounded-r-sm overflow-x-auto text-[10px] text-muted-foreground">
                                    <pre>{JSON.stringify(log.data, null, 2)}</pre>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>


        </div>
    );
}
