// ============================================================================
//  SPEDI BOAT v14.2
//  Fix:
//  ✅ Steering mapping diperbaiki (tidak terbalik)
//  ✅ Avoidance arah servo diperbaiki
//  ✅ delay() di UBX dikurangi drastis
//  ✅ Semua fix v14.1 tetap ada
// ============================================================================
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <TinyGPSPlus.h>
#include <Preferences.h>
#include <math.h>

// ============================================================================
// NETWORK CONFIGURATION
// ============================================================================
#define WIFI_SSID      "WikWek"
#define WIFI_PASSWORD  "11334455"

#define MQTT_BROKER    "metro.proxy.rlwy.net"
#define MQTT_PORT      41220
#define MQTT_USERNAME  "device"
#define MQTT_PASS      "spedi2026"
#define MQTT_CLIENT_ID "spedi-device-01"

// ============================================================================
// PIN MAP
// ============================================================================
#define RPWM_PIN        25
#define LPWM_PIN        26
#define R_EN_PIN        27
#define L_EN_PIN        14
#define SERVO_PIN       13

#define TRIG_LEFT_PIN   32
#define ECHO_LEFT_PIN   33
#define TRIG_RIGHT_PIN  18
#define ECHO_RIGHT_PIN  19

#define PIN_BUZZER      23
#define PIN_LED         22
#define PIN_PUMP        21

#define GPS_RX_PIN      16
#define GPS_TX_PIN      17

// ============================================================================
// LEDC (ESP32 Arduino Core 3.x)
// ============================================================================
#define PWM_FREQ        1000
#define PWM_RESOLUTION  8

// ============================================================================
// NAVIGATION & PHYSICS PARAMETERS
// ============================================================================
#define SERVO_CENTER      90
#define SERVO_MAX_LEFT    45
#define SERVO_MAX_RIGHT   135
#define SERVO_STEP_DEG    2
#define SERVO_INTERVAL_MS 12

#define MAX_SPEED         255
#define TURN_SPEED        120
#define AVOID_SPEED       130
#define APPROACH_SPEED    160

#define OBSTACLE_DIST     80
#define CRITICAL_DIST     35

#define RAMP_INTERVAL_MS  25
#define RAMP_UP_STEP      8
#define RAMP_DOWN_STEP    12
#define JOYSTICK_TIMEOUT  2000
#define SONAR_INTERVAL    60

#define WP_ARRIVAL_RADIUS_M  3.0f
#define WP_NAV_SPEED         180

// ============================================================================
// GPS LOCK THRESHOLDS
// ============================================================================
#define GPS_MIN_SAT      4
#define GPS_HDOP_GOOD    2.5f
#define GPS_HDOP_ACCEPT  5.0f
#define GPS_AGE_MS       3000

// ============================================================================
// GPS POSITION CACHE
// ============================================================================
#define GPS_DEFAULT_LAT      -2.953923
#define GPS_DEFAULT_LNG     104.748214
#define GPS_SAVE_INTERVAL_MS  60000

// ============================================================================
// STATE MACHINE ENUMS & HELPERS
// ============================================================================
enum DeviceMode { MODE_IDLE, MODE_MANUAL, MODE_AUTO };

const char* modeToString(DeviceMode m) {
  switch (m) {
    case MODE_MANUAL: return "manual";
    case MODE_AUTO:   return "auto";
    default:          return "idle";
  }
}

// ============================================================================
// GLOBAL OBJECTS
// ============================================================================
HardwareSerial gpsSerial(2);
TinyGPSPlus    gps;
Preferences    prefs;

WiFiClient     wifiClient;
PubSubClient   mqttClient(wifiClient);
Servo          steeringServo;

const char* TOPIC_JOYSTICK = "spedi/vehicle/joystick";
const char* TOPIC_ROUTE    = "spedi/vehicle/route";
const char* TOPIC_STATUS   = "spedi/vehicle/status";

// ============================================================================
// BUZZER — Non-blocking state machine
// ============================================================================
struct BuzzerState {
  bool          active     = false;
  int           totalBeeps = 0;
  int           beepsDone  = 0;
  int           durMs      = 0;
  bool          pinHigh    = false;
  unsigned long lastMs     = 0;
} buzzer;

void beepAsync(int durMs, int count) {
  buzzer.active     = true;
  buzzer.totalBeeps = count;
  buzzer.beepsDone  = 0;
  buzzer.durMs      = durMs;
  buzzer.pinHigh    = false;
  buzzer.lastMs     = millis();
  digitalWrite(PIN_BUZZER, LOW);
}

void updateBuzzer() {
  if (!buzzer.active) return;
  if (millis() - buzzer.lastMs < (unsigned long)buzzer.durMs) return;
  buzzer.lastMs = millis();
  if (!buzzer.pinHigh) {
    digitalWrite(PIN_BUZZER, HIGH);
    buzzer.pinHigh = true;
  } else {
    digitalWrite(PIN_BUZZER, LOW);
    buzzer.pinHigh = false;
    buzzer.beepsDone++;
    if (buzzer.beepsDone >= buzzer.totalBeeps) buzzer.active = false;
  }
}

void beepBlocking(int durMs, int count) {
  for (int i = 0; i < count; i++) {
    digitalWrite(PIN_BUZZER, HIGH); delay(durMs);
    digitalWrite(PIN_BUZZER, LOW);  delay(durMs);
  }
}

// ============================================================================
// STATE MACHINE — struct & buffers
// ============================================================================
struct Waypoint { double lat; double lng; };
#define MAX_WAYPOINTS 50

struct SystemState {
  DeviceMode    mode             = MODE_IDLE;
  bool          gpsLocked        = false;
  bool          gpsBuzzDone      = false;
  uint8_t       gpsConfirmCount  = 0;
  int           currentSpeed     = 0;
  int           targetSpeed      = 0;
  int           servoTarget      = SERVO_CENTER;
  int           servoCurrent     = SERVO_CENTER;
  bool          smartMoveActive  = false;
  bool          isAvoiding       = false;
  bool          autopilotActive  = false;
  Waypoint      waypoints[MAX_WAYPOINTS];
  int           waypointCount    = 0;
  int           waypointIndex    = 0;
  unsigned long lastRamp         = 0;
  unsigned long lastServoUpdate  = 0;
  unsigned long lastCommand      = 0;
  unsigned long lastSonarRead    = 0;
  unsigned long lastStatusPublish= 0;
  unsigned long lastGpsCheck     = 0;
  unsigned long lastMqttRetry    = 0;
  unsigned long lastGpsLog       = 0;
  unsigned long lastGpsSave      = 0;
  unsigned long bootTime         = 0;
} S;

#define FILTER_SAMPLES 5
int leftBuf[FILTER_SAMPLES]  = {400,400,400,400,400};
int rightBuf[FILTER_SAMPLES] = {400,400,400,400,400};
int bufIdx = 0;

// ============================================================================
// UTILITY
// ============================================================================
double haversineM(double lat1, double lon1, double lat2, double lon2) {
  const double R = 6371000.0;
  double dLat = radians(lat2 - lat1);
  double dLon = radians(lon2 - lon1);
  double a = sin(dLat/2)*sin(dLat/2) +
             cos(radians(lat1))*cos(radians(lat2))*
             sin(dLon/2)*sin(dLon/2);
  return R * 2.0 * atan2(sqrt(a), sqrt(1.0-a));
}

double bearingDeg(double lat1, double lon1, double lat2, double lon2) {
  double dLon = radians(lon2 - lon1);
  double y = sin(dLon) * cos(radians(lat2));
  double x = cos(radians(lat1))*sin(radians(lat2)) -
             sin(radians(lat1))*cos(radians(lat2))*cos(dLon);
  return fmod(degrees(atan2(y, x)) + 360.0, 360.0);
}

// ============================================================================
// MOTOR
// ============================================================================
void motorInit() {
  ledcAttach(RPWM_PIN, PWM_FREQ, PWM_RESOLUTION);
  ledcAttach(LPWM_PIN, PWM_FREQ, PWM_RESOLUTION);
}

void setMotorRaw(int speed) {
  speed = constrain(speed, -MAX_SPEED, MAX_SPEED);
  if (speed > 0) {
    ledcWrite(LPWM_PIN, 0);
    ledcWrite(RPWM_PIN, speed);
  } else if (speed < 0) {
    ledcWrite(RPWM_PIN, 0);
    ledcWrite(LPWM_PIN, -speed);
  } else {
    ledcWrite(RPWM_PIN, 0);
    ledcWrite(LPWM_PIN, 0);
  }
}

void updateMotorPhysics() {
  if (millis() - S.lastRamp < RAMP_INTERVAL_MS) return;
  S.lastRamp = millis();
  int diff = S.targetSpeed - S.currentSpeed;
  if      (diff >  RAMP_UP_STEP)   S.currentSpeed += RAMP_UP_STEP;
  else if (diff < -RAMP_DOWN_STEP) S.currentSpeed -= RAMP_DOWN_STEP;
  else                             S.currentSpeed  = S.targetSpeed;
  setMotorRaw(S.currentSpeed);
}

// ============================================================================
// UBX HELPER — Auto CRC Fletcher-8
// ✅ delay dikurangi dari 150ms → 10ms
// ============================================================================
void sendUBXCmd(uint8_t cls, uint8_t id, const uint8_t* payload, uint16_t len) {
  uint8_t ckA = 0, ckB = 0;
  auto addByte = [&](uint8_t b) {
    ckA = (ckA + b) & 0xFF;
    ckB = (ckB + ckA) & 0xFF;
  };
  addByte(cls); addByte(id);
  addByte((uint8_t)(len & 0xFF));
  addByte((uint8_t)(len >> 8));
  for (uint16_t i = 0; i < len; i++) addByte(payload[i]);

  gpsSerial.write(0xB5); gpsSerial.write(0x62);
  gpsSerial.write(cls);  gpsSerial.write(id);
  gpsSerial.write((uint8_t)(len & 0xFF));
  gpsSerial.write((uint8_t)(len >> 8));
  if (len > 0) gpsSerial.write(payload, len);
  gpsSerial.write(ckA);  gpsSerial.write(ckB);
  // ✅ Flush serial buffer, tidak perlu delay panjang
  gpsSerial.flush();
}

// ============================================================================
// SAVE LAST POSITION
// ============================================================================
void saveLastPosition(double lat, double lng) {
  prefs.begin("gps", false);
  prefs.putDouble("lat", lat);
  prefs.putDouble("lng", lng);
  prefs.end();
  Serial.printf("[GPS CACHE] Posisi disimpan: %.8f, %.8f\n", lat, lng);
}

// ============================================================================
// INJECT POSITION — UBX AID-INI
// ============================================================================
void injectPosition() {
  prefs.begin("gps", true);
  double lat = prefs.getDouble("lat", GPS_DEFAULT_LAT);
  double lng = prefs.getDouble("lng", GPS_DEFAULT_LNG);
  prefs.end();

  Serial.printf("[GPS CACHE] Inject posisi awal: %.8f, %.8f\n", lat, lng);

  int32_t latI = (int32_t)(lat * 1e7);
  int32_t lngI = (int32_t)(lng * 1e7);

  uint8_t payload[48] = {
    (uint8_t)latI,       (uint8_t)(latI>>8),  (uint8_t)(latI>>16), (uint8_t)(latI>>24),
    (uint8_t)lngI,       (uint8_t)(lngI>>8),  (uint8_t)(lngI>>16), (uint8_t)(lngI>>24),
    0xE8,0x03,0x00,0x00,
    0xE8,0x03,0x00,0x00,
    0x40,0x4B,0x4C,0x00,
    0x40,0x4B,0x4C,0x00,
    0x00,0x00,0x00,0x00,  0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,  0x00,0x00,0x00,0x00,
    0x00,0x00,0x00,0x00,
    0x01,0x00,0x00,0x00
  };

  sendUBXCmd(0x0B, 0x01, payload, sizeof(payload));
  Serial.println(F("[GPS CACHE] UBX AID-INI terkirim → TTFF lebih cepat"));
}

// ============================================================================
// GPS CONFIGURATION
// ============================================================================
void configureGPS() {
  Serial.println(F("[GPS] Mengirim konfigurasi UBX..."));

  static const uint8_t nav5[36] = {
    0xFF,0xFF, 0x02, 0x03,
    0x00,0x00,0x00,0x00,
    0x10,0x27,0x00,0x00,
    0x05, 0x00,
    0xFA,0x00, 0xFA,0x00,
    0x64,0x00, 0x2C,0x01,
    0x00, 0x3C, 0x00, 0x00,
    0x00,0x00, 0x00,0x00,
    0x00, 0x00,0x00,0x00,0x00
  };
  sendUBXCmd(0x06, 0x24, nav5, sizeof(nav5));
  Serial.println(F("[GPS] CFG-NAV5 (Stationary) terkirim."));

  static const uint8_t sbas[8] = { 0x01,0x03,0x03,0x00, 0x00,0x00,0x00,0x00 };
  sendUBXCmd(0x06, 0x16, sbas, sizeof(sbas));
  Serial.println(F("[GPS] CFG-SBAS terkirim."));

  static const uint8_t rate[6] = { 0xC8,0x00, 0x01,0x00, 0x01,0x00 };
  sendUBXCmd(0x06, 0x08, rate, sizeof(rate));
  Serial.println(F("[GPS] CFG-RATE 5Hz terkirim."));

  static const uint8_t msgGGA[8] = { 0xF0,0x00, 0x00,0x01,0x00,0x00,0x00,0x00 };
  static const uint8_t msgRMC[8] = { 0xF0,0x04, 0x00,0x01,0x00,0x00,0x00,0x00 };
  static const uint8_t msgGSV[8] = { 0xF0,0x03, 0x00,0x01,0x00,0x00,0x00,0x00 };
  sendUBXCmd(0x06, 0x01, msgGGA, 8);
  sendUBXCmd(0x06, 0x01, msgRMC, 8);
  sendUBXCmd(0x06, 0x01, msgGSV, 8);
  Serial.println(F("[GPS] CFG-MSG NMEA terkirim."));

  static const uint8_t saveCfg[12] = {
    0x00,0x00,0x00,0x00, 0xFF,0xFF,0x00,0x00, 0x00,0x00,0x00,0x00
  };
  sendUBXCmd(0x06, 0x09, saveCfg, sizeof(saveCfg));
  Serial.println(F("[GPS] CFG-CFG (save) terkirim.\n[GPS] Konfigurasi selesai."));
}

// ============================================================================
// GPS — Feed & Quality
// ============================================================================
void feedGPS() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
}

uint8_t getGpsQuality() {
  if (!gps.location.isValid())              return 0;
  if (gps.location.age() > GPS_AGE_MS)      return 0;
  if (!gps.satellites.isValid())            return 1;
  if (gps.satellites.value() < GPS_MIN_SAT) return 1;
  if (!gps.hdop.isValid())                  return 1;
  if (gps.hdop.hdop() > GPS_HDOP_ACCEPT)    return 1;
  if (gps.hdop.hdop() > GPS_HDOP_GOOD)      return 2;
  return 3;
}

bool checkGpsLock() { return getGpsQuality() >= 2; }

// ============================================================================
// GPS LOCK FSM — Non-blocking
// ============================================================================
void updateGpsLockFSM() {
  if (S.gpsLocked && S.gpsBuzzDone) return;

  feedGPS();

  if (!S.gpsLocked && millis() - S.lastGpsLog >= 1000) {
    S.lastGpsLog = millis();
    uint8_t  q    = getGpsQuality();
    uint8_t  sats = gps.satellites.isValid() ? (uint8_t)gps.satellites.value() : 0;
    float    hdop = gps.hdop.isValid()        ? gps.hdop.hdop()                 : 99.9f;
    double   lat  = gps.location.isValid()    ? gps.location.lat()              : 0.0;
    double   lng  = gps.location.isValid()    ? gps.location.lng()              : 0.0;
    unsigned long elapsed = (millis() - S.bootTime) / 1000;

    const char* qlabel;
    switch (q) {
      case 0:  qlabel = "SEARCHING"; break;
      case 1:  qlabel = "WEAK SAT "; break;
      case 2:  qlabel = "WEAK FIX "; break;
      case 3:  qlabel = "GOOD FIX "; break;
      default: qlabel = "???      "; break;
    }
    Serial.printf("[GPS] T+%3lus | %s | Sat:%2u | HDOP:%.1f | Lat:%.6f Lng:%.6f\n",
      elapsed, qlabel, sats, hdop, lat, lng);
  }

  if (!S.gpsLocked) {
    if (checkGpsLock()) S.gpsConfirmCount++;
    else                S.gpsConfirmCount = 0;

    if (S.gpsConfirmCount >= 4) {
      S.gpsLocked = true;
      digitalWrite(PIN_LED, HIGH);

      Serial.println(F("\n[GPS] ============================================"));
      Serial.println(F("[GPS]  *** GPS TERKUNCI! ***"));
      Serial.printf( "[GPS]  Lat       : %.8f\n",      gps.location.lat());
      Serial.printf( "[GPS]  Lng       : %.8f\n",      gps.location.lng());
      Serial.printf( "[GPS]  Satelit   : %u\n",        (unsigned)gps.satellites.value());
      Serial.printf( "[GPS]  HDOP      : %.2f\n",      gps.hdop.hdop());
      Serial.printf( "[GPS]  Quality   : %u/3\n",      getGpsQuality());
      Serial.printf( "[GPS]  Waktu lock: %lu detik\n", (millis() - S.bootTime) / 1000);
      Serial.println(F("[GPS] ============================================\n"));

      saveLastPosition(gps.location.lat(), gps.location.lng());
      S.lastGpsSave = millis();

      if (!S.gpsBuzzDone) {
        beepAsync(200, 3);
        S.gpsBuzzDone = true;
      }
    }
  }

  if (!S.gpsLocked) {
    static unsigned long lastToggle = 0;
    static bool ledState = false;
    uint8_t q = getGpsQuality();
    unsigned long interval;
    switch (q) {
      case 0:  interval = 120; break;
      case 1:  interval = 400; break;
      default: interval = 800; break;
    }
    if (millis() - lastToggle >= interval) {
      lastToggle = millis();
      ledState   = !ledState;
      digitalWrite(PIN_LED, ledState);
    }
  }
}

// ============================================================================
// SERVO
// ============================================================================
void updateServoSmooth() {
  if (millis() - S.lastServoUpdate < SERVO_INTERVAL_MS) return;
  S.lastServoUpdate = millis();
  if (S.servoCurrent == S.servoTarget) return;
  int diff = S.servoTarget - S.servoCurrent;
  S.servoCurrent += (abs(diff) <= SERVO_STEP_DEG)
    ? diff : ((diff > 0) ? SERVO_STEP_DEG : -SERVO_STEP_DEG);
  steeringServo.write(S.servoCurrent);
}

void setServoTarget(int angle) {
  S.servoTarget = constrain(angle, SERVO_MAX_LEFT, SERVO_MAX_RIGHT);
}

// ============================================================================
// ULTRASONIC
// ============================================================================
int readFilteredDist(int trig, int echo, int* buf) {
  digitalWrite(trig, LOW);  delayMicroseconds(2);
  digitalWrite(trig, HIGH); delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long dur = pulseIn(echo, HIGH, 25000);
  int  raw = (dur == 0) ? 400 : (int)(dur * 0.017f);
  buf[bufIdx] = raw;
  long sum = 0;
  for (int i = 0; i < FILTER_SAMPLES; i++) sum += buf[i];
  return (int)(sum / FILTER_SAMPLES);
}

// ============================================================================
// AVOIDANCE
// ✅ FIX: sensor kiri → hindari ke kiri (servo MAX_LEFT)
//         sensor kanan → hindari ke kanan (servo MAX_RIGHT)
//         logika sebelumnya terbalik
// ============================================================================
bool processAvoidance() {
  if (millis() - S.lastSonarRead < SONAR_INTERVAL) return S.isAvoiding;
  S.lastSonarRead = millis();

  int dL = readFilteredDist(TRIG_LEFT_PIN,  ECHO_LEFT_PIN,  leftBuf);
  int dR = readFilteredDist(TRIG_RIGHT_PIN, ECHO_RIGHT_PIN, rightBuf);
  bufIdx = (bufIdx + 1) % FILTER_SAMPLES;

  if (dL < CRITICAL_DIST && dR < CRITICAL_DIST) {
    // Kedua sisi terblokir → mundur
    S.targetSpeed = -AVOID_SPEED;
    setServoTarget(SERVO_CENTER);
    S.isAvoiding = true;
  } else if (dL < OBSTACLE_DIST) {
    // Halangan di KIRI → belok ke KANAN
    S.targetSpeed = AVOID_SPEED;
    setServoTarget(SERVO_MAX_RIGHT);
    S.isAvoiding = true;
  } else if (dR < OBSTACLE_DIST) {
    // Halangan di KANAN → belok ke KIRI
    S.targetSpeed = AVOID_SPEED;
    setServoTarget(SERVO_MAX_LEFT);
    S.isAvoiding = true;
  } else {
    S.isAvoiding = false;
  }

  S.smartMoveActive = S.isAvoiding;
  return S.isAvoiding;
}

// ============================================================================
// JOYSTICK
// ✅ FIX: steering sebelumnya terbalik karena nilai negatif/positif
//    Konvensi baru:
//      steering > 0  → belok KANAN → servo > CENTER
//      steering < 0  → belok KIRI  → servo < CENTER
//      throttle > 0  → MAJU
//      throttle < 0  → MUNDUR
// ============================================================================
void handleJoystick(JsonDocument& doc) {
  if (S.smartMoveActive) return;

  if (S.mode == MODE_AUTO) {
    S.autopilotActive = false;
    S.waypointCount   = 0;
    S.waypointIndex   = 0;
    Serial.println("[NAV] Rute otonom dibatalkan — manual override");
  }
  S.mode = MODE_MANUAL;

  int throttle = doc["throttle"] | 0;  // -100 s/d +100
  int steering = doc["steering"] | 0;  // -100 s/d +100

  // Throttle: positif = maju, negatif = mundur
  S.targetSpeed = (int)((float)throttle / 100.0f * MAX_SPEED);

  // ✅ Steering: positif = kanan (servo naik dari center)
  //              negatif = kiri  (servo turun dari center)
  // Jika sebelumnya terbalik, cukup tambahkan tanda minus di steering
  int steerAngle = SERVO_CENTER + (int)((float)steering / 100.0f * 45.0f);
  setServoTarget(steerAngle);

  S.lastCommand = millis();
}

// ============================================================================
// ROUTE
// ============================================================================
void handleRoute(JsonDocument& doc) {
  if (!S.gpsLocked) return;

  const char* action = doc["action"] | "";

  if (strcmp(action, "start") == 0) {
    JsonArray wps = doc["waypoints"];
    int count = min((int)wps.size(), MAX_WAYPOINTS);
    if (count < 2) {
      Serial.println("[NAV] Rute ditolak — butuh >= 2 waypoint");
      return;
    }
    for (int i = 0; i < count; i++) {
      S.waypoints[i].lat = wps[i]["lat"] | 0.0;
      S.waypoints[i].lng = wps[i]["lng"] | 0.0;
    }
    S.waypointCount   = count;
    S.waypointIndex   = 0;
    S.autopilotActive = true;
    S.mode            = MODE_AUTO;
    Serial.printf("[NAV] Rute dimulai: %d waypoint\n", count);
  } else if (strcmp(action, "stop") == 0) {
    S.autopilotActive = false;
    S.waypointCount   = 0;
    S.waypointIndex   = 0;
    S.targetSpeed     = 0;
    S.mode            = MODE_IDLE;
    setServoTarget(SERVO_CENTER);
    Serial.println("[NAV] Rute dihentikan oleh server");
  }
}

// ============================================================================
// AUTOPILOT
// ============================================================================
void updateAutopilot() {
  if (!S.autopilotActive || S.waypointIndex >= S.waypointCount) {
    if (S.autopilotActive) {
      S.autopilotActive = false;
      S.targetSpeed     = 0;
      S.mode            = MODE_IDLE;
      setServoTarget(SERVO_CENTER);
      Serial.println("[NAV] Semua waypoint tercapai — rute selesai");
    }
    return;
  }

  if (!gps.location.isValid() || gps.location.age() > 2000) return;

  double curLat = gps.location.lat();
  double curLng = gps.location.lng();
  double tgtLat = S.waypoints[S.waypointIndex].lat;
  double tgtLng = S.waypoints[S.waypointIndex].lng;

  double dist    = haversineM(curLat, curLng, tgtLat, tgtLng);
  double bearing = bearingDeg(curLat, curLng, tgtLat, tgtLng);
  double heading = gps.course.isValid() ? gps.course.deg() : bearing;

  if (dist < WP_ARRIVAL_RADIUS_M) {
    S.waypointIndex++;
    Serial.printf("[NAV] Waypoint %d tercapai (%.1fm). Berikutnya: %d/%d\n",
      S.waypointIndex, dist, S.waypointIndex + 1, S.waypointCount);
    return;
  }

  if (processAvoidance()) return;

  double error = bearing - heading;
  if (error >  180.0) error -= 360.0;
  if (error < -180.0) error += 360.0;

  int steerAngle = SERVO_CENTER + (int)(error / 90.0 * 45.0);
  setServoTarget(constrain(steerAngle, SERVO_MAX_LEFT, SERVO_MAX_RIGHT));

  if      (dist < 5.0)           S.targetSpeed = APPROACH_SPEED;
  else if (abs((int)error) > 45) S.targetSpeed = TURN_SPEED;
  else                           S.targetSpeed = WP_NAV_SPEED;
}

// ============================================================================
// MQTT
// ============================================================================
void reconnectMqtt() {
  if (millis() - S.lastMqttRetry < 5000) return;
  S.lastMqttRetry = millis();
  Serial.println("[MQTT] Menghubungkan...");
  if (!mqttClient.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASS)) {
    Serial.printf("[MQTT] Gagal, rc=%d\n", mqttClient.state());
    return;
  }
  mqttClient.subscribe(TOPIC_JOYSTICK);
  mqttClient.subscribe(TOPIC_ROUTE);
  Serial.println("[MQTT] Terhubung ke broker.");
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length) != DeserializationError::Ok) return;
  String t(topic);
  if      (t == TOPIC_JOYSTICK) handleJoystick(doc);
  else if (t == TOPIC_ROUTE)    handleRoute(doc);
}

// ============================================================================
// TELEMETRY
// ============================================================================
void publishTelemetry() {
  if (!mqttClient.connected()) return;
  if (millis() - S.lastStatusPublish < 2000) return;
  S.lastStatusPublish = millis();

  int dL = readFilteredDist(TRIG_LEFT_PIN,  ECHO_LEFT_PIN,  leftBuf);
  int dR = readFilteredDist(TRIG_RIGHT_PIN, ECHO_RIGHT_PIN, rightBuf);

  JsonDocument doc;
  doc["lat"]               = gps.location.isValid() ? gps.location.lat() : 0.0;
  doc["lng"]               = gps.location.isValid() ? gps.location.lng() : 0.0;
  doc["satellite_count"]   = (int)gps.satellites.value();
  doc["waypoint_index"]    = S.waypointIndex;
  doc["mode"]              = modeToString(S.mode);
  doc["obstacle_left"]     = dL;
  doc["obstacle_right"]    = dR;
  doc["smart_move_active"] = S.smartMoveActive;
  doc["autopilot_active"]  = S.autopilotActive;
  doc["bearing"]           = gps.course.isValid() ? gps.course.deg() : 0.0;
  doc["speed"]             = gps.speed.isValid()  ? gps.speed.kmph() : 0.0;
  doc["hdop"]              = gps.hdop.isValid()   ? gps.hdop.hdop()  : 99.99;
  doc["motor_speed"]       = S.currentSpeed;
  doc["gps_fix"]           = S.gpsLocked;
  doc["gps_quality"]       = getGpsQuality();

  char buf[512];
  serializeJson(doc, buf, sizeof(buf));
  mqttClient.publish(TOPIC_STATUS, buf);
}

// ============================================================================
// SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println(F("\n=== SPEDI BOAT v14.2 — BOOT ==="));
  Serial.println(F("=== Fix: steering logic + no delay UBX ===\n"));

  pinMode(PIN_LED,        OUTPUT); digitalWrite(PIN_LED,    LOW);
  pinMode(PIN_BUZZER,     OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_PUMP,       OUTPUT); digitalWrite(PIN_PUMP,   LOW);
  pinMode(R_EN_PIN,       OUTPUT); digitalWrite(R_EN_PIN,   HIGH);
  pinMode(L_EN_PIN,       OUTPUT); digitalWrite(L_EN_PIN,   HIGH);
  pinMode(TRIG_LEFT_PIN,  OUTPUT); pinMode(ECHO_LEFT_PIN,   INPUT);
  pinMode(TRIG_RIGHT_PIN, OUTPUT); pinMode(ECHO_RIGHT_PIN,  INPUT);
  Serial.println(F("[INIT] Pin OK"));

  motorInit();
  setMotorRaw(0);
  Serial.println(F("[INIT] Motor PWM OK"));

  steeringServo.attach(SERVO_PIN);
  steeringServo.write(SERVO_CENTER);
  S.servoCurrent = SERVO_CENTER;
  S.servoTarget  = SERVO_CENTER;
  Serial.println(F("[INIT] Servo OK"));

  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  delay(500);
  injectPosition();
  configureGPS();

  Serial.printf("[WIFI] Menghubungkan ke: %s\n", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500); Serial.print("."); attempts++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("[WIFI] Terhubung! IP: " + WiFi.localIP().toString());
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setBufferSize(1024);
    mqttClient.setCallback(onMqttMessage);
    reconnectMqtt();
  } else {
    Serial.println(F("[WIFI] Gagal — MQTT tidak aktif."));
  }

  beepBlocking(80, 2);
  S.bootTime = millis();

  Serial.println(F("[SYSTEM] Hardware siap. Mesin AKTIF."));
  Serial.println(F("[SYSTEM] Menunggu GPS lock untuk navigasi..."));
  Serial.println(F("[SYSTEM] (Posisi cache sudah diinjeksi — lock lebih cepat)\n"));
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
  // 1. GPS lock FSM (non-blocking)
  updateGpsLockFSM();

  // 2. Buzzer state machine
  updateBuzzer();

  // 3. GPS loss warning setelah lock
  if (S.gpsLocked && millis() - S.lastGpsCheck > 5000) {
    S.lastGpsCheck = millis();
    uint8_t q = getGpsQuality();
    if (q < 2) {
      Serial.printf("[GPS] PERINGATAN: Fix lemah! Quality:%u | Sat:%u | HDOP:%.1f\n",
        q,
        gps.satellites.isValid() ? (unsigned)gps.satellites.value() : 0,
        gps.hdop.isValid() ? gps.hdop.hdop() : 99.9f);
    }
  }

  // 4. Simpan posisi ke flash setiap 60 detik setelah lock
  if (S.gpsLocked &&
      gps.location.isValid() &&
      millis() - S.lastGpsSave >= GPS_SAVE_INTERVAL_MS) {
    saveLastPosition(gps.location.lat(), gps.location.lng());
    S.lastGpsSave = millis();
  }

  // 5. Servo
  updateServoSmooth();

  // 6. Motor ramp
  updateMotorPhysics();

  // 7. Mode FSM
  switch (S.mode) {
    case MODE_MANUAL:
      if (millis() - S.lastCommand > JOYSTICK_TIMEOUT) S.targetSpeed = 0;
      processAvoidance();
      break;
    case MODE_AUTO:
      updateAutopilot();
      break;
    case MODE_IDLE:
    default:
      S.targetSpeed = 0;
      break;
  }

  // 8. WiFi + MQTT
  if (WiFi.status() == WL_CONNECTED) {
    if (!mqttClient.connected()) reconnectMqtt();
    mqttClient.loop();
  }

  // 9. Telemetri
  publishTelemetry();
}