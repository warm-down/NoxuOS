#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>

// NoxuOS sensor node firmware.
// Keep physical actions allowlisted. This sketch reports sensor status and only
// supports harmless onboard LED/read-status commands by default.

const char* DEVICE_ID = "esp32s3-001";
const char* DEVICE_ROLE = "sensor_node";
const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASS";
const char* EMPIRE_WS_HOST = "192.168.1.10";
const int EMPIRE_WS_PORT = 8765;

#define PIR_PIN 5
#define LED_PIN 2
#define MIC_PIN 34

WebSocketsClient webSocket;

unsigned long lastReport = 0;
const unsigned long REPORT_INTERVAL = 5000;
const int AUDIO_THRESHOLD = 3000;

void setup() {
  Serial.begin(115200);
  delay(1000);

  pinMode(PIR_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(MIC_PIN, INPUT);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("[ESP32] WiFi connected, IP: ");
  Serial.println(WiFi.localIP());

  webSocket.begin(EMPIRE_WS_HOST, EMPIRE_WS_PORT, "/");
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();

  if (digitalRead(PIR_PIN) == HIGH) {
    sendAlert("motion_detected", "Motion sensor triggered");
    delay(1000);
  }

  if (analogRead(MIC_PIN) > AUDIO_THRESHOLD) {
    sendAlert("audio_trigger", "Sound detected");
    delay(1000);
  }

  if (millis() - lastReport > REPORT_INTERVAL) {
    sendStatus();
    lastReport = millis();
  }
}

void registerDevice() {
  StaticJsonDocument<512> doc;
  doc["type"] = "register";
  doc["agent_id"] = DEVICE_ID;
  doc["role"] = DEVICE_ROLE;
  doc["ip"] = WiFi.localIP().toString();
  doc["sensors"] = "motion,audio,wifi,heap";

  char buffer[512];
  serializeJson(doc, buffer);
  webSocket.sendTXT(buffer);
}

void sendStatus() {
  StaticJsonDocument<512> doc;
  doc["type"] = "status";
  doc["from"] = DEVICE_ID;
  doc["role"] = DEVICE_ROLE;
  doc["timestamp"] = millis();

  JsonObject data = doc.createNestedObject("data");
  data["motion"] = digitalRead(PIR_PIN);
  data["audio_level"] = analogRead(MIC_PIN);
  data["wifi_rssi"] = WiFi.RSSI();
  data["free_heap"] = ESP.getFreeHeap();

  char buffer[512];
  serializeJson(doc, buffer);
  webSocket.sendTXT(buffer);
}

void sendAlert(const char* alertType, const char* message) {
  StaticJsonDocument<512> doc;
  doc["type"] = "alert";
  doc["from"] = DEVICE_ID;
  doc["alert_type"] = alertType;
  doc["message"] = message;
  doc["timestamp"] = millis();

  char buffer[512];
  serializeJson(doc, buffer);
  webSocket.sendTXT(buffer);

  digitalWrite(LED_PIN, HIGH);
  delay(100);
  digitalWrite(LED_PIN, LOW);
}

void webSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.println("[ESP32] WebSocket connected");
      registerDevice();
      break;

    case WStype_DISCONNECTED:
      Serial.println("[ESP32] WebSocket disconnected");
      break;

    case WStype_TEXT: {
      StaticJsonDocument<512> doc;
      DeserializationError error = deserializeJson(doc, payload);
      if (error) return;

      const char* command = doc["command"];
      if (!command) return;

      if (strcmp(command, "led_on") == 0) {
        digitalWrite(LED_PIN, HIGH);
        sendAlert("ack", "LED turned on");
      } else if (strcmp(command, "led_off") == 0) {
        digitalWrite(LED_PIN, LOW);
        sendAlert("ack", "LED turned off");
      } else if (strcmp(command, "get_reading") == 0) {
        sendStatus();
      } else {
        sendAlert("rejected_command", "Command is not in the safe allowlist");
      }
      break;
    }

    default:
      break;
  }
}
