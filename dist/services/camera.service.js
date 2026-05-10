"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cameraService = void 0;
const config_service_1 = require("./config.service");
const sse_service_1 = require("./sse.service");
const log_service_1 = require("./log.service");
class CameraService {
    latestSnapshot = null; // Base64 encoded JPEG
    /**
     * Ingest an incoming camera MQTT payload.
     * Enforces size limits and immediately broadcasts to SSE listeners.
     * Does NOT save to PostgreSQL.
     */
    ingest(topic, payload) {
        const maxBytes = parseInt(config_service_1.configService.get('camera_max_payload_bytes') || '256000', 10);
        if (payload.length > maxBytes) {
            log_service_1.logService.warn('arduino', 'camera', `Camera payload dropped: ${payload.length} bytes exceeds ${maxBytes} byte limit`, { topic, size: payload.length });
            return;
        }
        // Convert buffer to Base64 data URI (assume JPEG for now, typical for ESP32-CAM)
        const base64Data = payload.toString('base64');
        const dataUri = `data:image/jpeg;base64,${base64Data}`;
        this.latestSnapshot = dataUri;
        log_service_1.logService.info('arduino', 'camera', 'Received new camera snapshot', { sizeBytes: payload.length });
        // Broadcast snapshot via SSE
        sse_service_1.sseService.broadcast({
            type: 'camera_snapshot',
            payload: {
                timestamp: new Date().toISOString(),
                dataUri
            }
        });
    }
    getLatestSnapshot() {
        return this.latestSnapshot;
    }
}
exports.cameraService = new CameraService();
