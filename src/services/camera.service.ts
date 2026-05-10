import { configService } from './config.service';
import { sseService } from './sse.service';
import { logService } from './log.service';

class CameraService {
    private latestSnapshot: string | null = null; // Base64 encoded JPEG

    /**
     * Ingest an incoming camera MQTT payload.
     * Enforces size limits and immediately broadcasts to SSE listeners.
     * Does NOT save to PostgreSQL.
     */
    ingest(topic: string, payload: Buffer): void {
        const maxBytes = parseInt(configService.get('camera_max_payload_bytes') || '256000', 10);

        if (payload.length > maxBytes) {
            logService.warn('arduino', 'camera', `Camera payload dropped: ${payload.length} bytes exceeds ${maxBytes} byte limit`, { topic, size: payload.length });
            return;
        }

        // Convert buffer to Base64 data URI (assume JPEG for now, typical for ESP32-CAM)
        const base64Data = payload.toString('base64');
        const dataUri = `data:image/jpeg;base64,${base64Data}`;

        this.latestSnapshot = dataUri;

        logService.info('arduino', 'camera', 'Received new camera snapshot', { sizeBytes: payload.length });

        // Broadcast snapshot via SSE
        sseService.broadcast({
            type: 'camera_snapshot',
            payload: {
                timestamp: new Date().toISOString(),
                dataUri
            }
        });
    }

    public getLatestSnapshot(): string | null {
        return this.latestSnapshot;
    }
}

export const cameraService = new CameraService();
