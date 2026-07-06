# ESP32 Sensor Node

This firmware connects an ESP32 sensor node to the NoxuOS Pi 5 agent bus.

Default behavior is intentionally conservative:

- Reports motion, audio level, Wi-Fi RSSI, and free heap.
- Sends alerts for motion/audio triggers.
- Accepts only `led_on`, `led_off`, and `get_reading` commands.
- Rejects all other commands.

Before flashing, edit:

```cpp
WIFI_SSID
WIFI_PASS
EMPIRE_WS_HOST
DEVICE_ID
DEVICE_ROLE
```

Arduino libraries:

- `WebSocketsClient`
- `ArduinoJson`
