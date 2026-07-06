# Local Camera Integration Notes

Use this area to document cameras that you own or administer.

Recommended fields per camera:

```text
Name:
Location:
Static IP:
MAC:
Integration: ONVIF / Generic Camera / Other
Camera user:
RTSP URL stored in HA secrets: yes/no
Notes:
```

Local-first rules:

- Prefer ONVIF discovery when available.
- Prefer RTSP substreams for dashboard previews to reduce load.
- Create a Home Assistant-specific camera user.
- Keep credentials in Home Assistant secrets, not in this repository.
- Do not scan or add public cameras or third-party networks.
