"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logService = void 0;
const crypto_1 = require("crypto");
const sse_service_1 = require("./sse.service");
class LogService {
    logs = [];
    MAX_LOGS = 200;
    /**
     * Add a log entry to the circular buffer and instantly broadcast via SSE.
     */
    log(source, level, type, message, data) {
        const entry = {
            id: (0, crypto_1.randomUUID)(),
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
        sse_service_1.sseService.broadcast({
            type: 'syslog',
            payload: entry
        });
    }
    info(source, type, message, data) {
        this.log(source, 'info', type, message, data);
    }
    warn(source, type, message, data) {
        this.log(source, 'warn', type, message, data);
    }
    error(source, type, message, data) {
        this.log(source, 'error', type, message, data);
    }
    getRecentLogs() {
        return [...this.logs];
    }
}
exports.logService = new LogService();
