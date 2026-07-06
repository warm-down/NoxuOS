# Home Assistant OS Transition Runbook

This folder documents the Raspberry Pi 5 move from Raspberry Pi OS to Home Assistant OS.

## Role Change

Home Assistant OS is an appliance-style OS. After the Pi boots HAOS, do not expect normal `apt`, `git`, `systemd`, or the old `empire-pi.service` workflow on the Pi itself.

New split:

```text
Raspberry Pi 5  = Home Assistant OS, ESPHome, MQTT, device automations
Kali XPS        = NoxuOS control laptop, security worker, AI/agent tools
Other AI host   = Ollama/Open WebUI/model runner if needed
```

NoxuOS mesh coordination should run from the laptop or another Linux host. Later, if needed, it can become a Home Assistant add-on, but do not block the HAOS install on that.

## First Boot

1. Flash **Home Assistant OS for Raspberry Pi 5** with Raspberry Pi Imager.
2. Insert the card, boot the Pi, and wait several minutes.
3. Open one of:

```text
http://homeassistant.local:8123
http://<pi-ip-address>:8123
```

4. Complete onboarding and create the owner account.
5. Set a static DHCP lease for the Pi in the router if possible.

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

After creating a Home Assistant long-lived access token:

```bash
HOME_ASSISTANT_TOKEN="paste-token" HOME_ASSISTANT_URL=http://192.168.1.X:8123 ./tools/haos-lan-check.sh
```

## Recovery Notes

- If `homeassistant.local` does not resolve, use the router client list to find the Pi IP.
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
