import { randomUUID } from 'crypto';
import { sseService } from './sse.service';

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

class LogService {
    private logs: LogEntry[] = [];
    private readonly MAX_LOGS = 200;

    /**
     * Add a log entry to the circular buffer and instantly broadcast via SSE.
     */
    public log(source: LogSource, level: LogLevel, type: LogType, message: string, data?: any) {
        const entry: LogEntry = {
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            source,
            level,
            type,
            message,
            data
        };

        this.logs.unshift(entry); // Add to beginning (newest first)

        if (this.logs.length > this.MAX_LOGS) {
            this.logs.pop(); // Remove oldest
        }

        // Broadcast to all dashboard clients
        sseService.broadcast({
            type: 'syslog',
            payload: entry
        });
    }

    public info(source: LogSource, type: LogType, message: string, data?: any) {
        this.log(source, 'info', type, message, data);
    }

    public warn(source: LogSource, type: LogType, message: string, data?: any) {
        this.log(source, 'warn', type, message, data);
    }

    public error(source: LogSource, type: LogType, message: string, data?: any) {
        this.log(source, 'error', type, message, data);
    }

    public getRecentLogs(): LogEntry[] {
        return [...this.logs];
    }
}

export const logService = new LogService();
