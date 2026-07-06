# Home Assistant OS On Raspberry Pi 400

This folder documents the Raspberry Pi 400 Home Assistant OS deployment.

## Role Split

The Raspberry Pi 5 stays on its current Linux operating system and continues running NoxuOS/Linux services.

Home Assistant OS is installed on the Raspberry Pi 400. HAOS is an appliance-style OS, so do not expect normal `apt`, `git`, `systemd`, or NoxuOS worker scripts on the Pi 400 itself.

New split:

```text
Kali XPS          = administration, NoxuOS development, orchestration
Raspberry Pi 5    = Linux compute node, AI/services, NoxuOS components
Raspberry Pi 400  = Home Assistant OS, ESPHome, MQTT, dashboards, cameras
ESP32 boards      = ESPHome/MQTT devices managed by Home Assistant
```

NoxuOS mesh coordination should run from Kali, the Pi 5, or another Linux host. Later, if useful, it can become a Home Assistant add-on, but do not block the HAOS setup on that.

## First Boot

1. Flash **Home Assistant OS for Raspberry Pi 400** with Raspberry Pi Imager.
   - If Raspberry Pi Imager presents a Raspberry Pi 4/400 image, use that.
   - If it only lists Raspberry Pi 4 and Raspberry Pi 5 images, use the Raspberry Pi 4 image for the Pi 400.
2. Insert the dedicated HAOS microSD card into the Pi 400, boot it, and wait several minutes.
3. Open one of:

```text
http://homeassistant.local:8123
http://<pi-ip-address>:8123
```

4. Complete onboarding and create the owner account.
5. Set a static DHCP lease for the Pi 400 in the router if possible.
6. Keep the Raspberry Pi 5 SD card and configuration unchanged.

## Essential Add-ons

Install these from Home Assistant:

```text
Settings -> Add-ons -> Add-on Store
```

Recommended base:

- **ESPHome Device Builder** for provisioning ESP32 boards.
- **Mosquitto broker** for MQTT.
- **Terminal & SSH** or **Advanced SSH & Web Terminal** for HAOS maintenance.
- **Studio Code Server** for editing configuration from the browser.
- **Samba share** if you want easy local config backups from the laptop.

The SSH add-on is for Home Assistant OS maintenance only. It is not the same as normal Raspberry Pi OS SSH access.

## ESPHome

1. Install ESPHome Device Builder.
2. Start it and enable "Show in sidebar".
3. Add Wi-Fi secrets in ESPHome:

```yaml
wifi_ssid: "your-wifi"
wifi_password: "your-password"
fallback_ap_password: "local-fallback-password"
```

4. Use [`esphome/esp32-status-node.yaml`](esphome/esp32-status-node.yaml) as the first safe node template.
5. Flash over USB for the first install, then use OTA.

## MQTT

Install Mosquitto broker and then add the MQTT integration:

```text
Settings -> Devices & services -> Add integration -> MQTT
```

For the built-in add-on, Home Assistant can configure MQTT automatically. Prefer generated credentials or a dedicated local-only HA user.

## Cameras

Use only cameras you own or administer.

Preferred order:

1. **ONVIF integration** for supported cameras.
2. **Generic Camera integration** for known local RTSP/HTTP streams.
3. A dedicated local NVR later, if needed.

Create a separate standard user on each camera for Home Assistant. Do not use admin credentials unless the device requires it.

## Laptop Verification

From Kali or the control laptop:

```bash
cd ~/NoxuOS
git pull
HOME_ASSISTANT_URL=http://homeassistant.local:8123 ./tools/haos-lan-check.sh
```

If mDNS fails:

```bash
HOME_ASSISTANT_URL=http://192.168.1.X:8123 ./tools/haos-lan-check.sh
```

Use the Pi 400 IP here, not the Pi 5 IP.

After creating a Home Assistant long-lived access token:

```bash
HOME_ASSISTANT_TOKEN="paste-token" HOME_ASSISTANT_URL=http://192.168.1.X:8123 ./tools/haos-lan-check.sh
```

## Recovery Notes

- If `homeassistant.local` does not resolve, use the router client list to find the Pi 400 IP.
- If `8123` is closed, wait longer on first boot or check HDMI console output.
- If MQTT `1883` is closed, Mosquitto is not installed/running yet.
- If ESPHome dashboard `6052` is closed, the ESPHome add-on is not installed/running yet.
- Keep a copy of important YAML and notes in this repo, but keep secrets inside Home Assistant's secrets storage.

## Official References

- Home Assistant Raspberry Pi install: https://www.home-assistant.io/installation/raspberrypi/
- ESPHome integration: https://www.home-assistant.io/integrations/esphome/
- MQTT integration: https://www.home-assistant.io/integrations/mqtt/
- Mosquitto broker add-on: https://www.home-assistant.io/addons/mosquitto/
- ONVIF integration: https://www.home-assistant.io/integrations/onvif/
- Generic Camera integration: https://www.home-assistant.io/integrations/generic/
- Home Assistant REST API: https://developers.home-assistant.io/docs/api/rest/
