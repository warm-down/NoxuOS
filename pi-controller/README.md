# Pi 5 Controller

This is the first controller for the NoxuOS AI Empire mesh. It accepts device registrations over HTTP and routes agent bus messages over WebSocket.

## Install On Raspberry Pi 5

```bash
sudo apt update
sudo apt install -y python3-pip
python3 -m pip install -r requirements.txt
python3 pi-controller.py
```

## Install As Boot Service

For the Golden Master SD card, run this on the Pi:

```bash
cd /home/pi/NoxuOS/pi-controller
chmod +x install-pi-service.sh
./install-pi-service.sh
```

The installer:

- Installs `python3-pip` and `git`.
- Pulls or clones `https://github.com/warm-down/NoxuOS.git`.
- Installs Python requirements.
- Installs `empire-pi.service`.
- Enables and restarts the service.

Manual service commands:

```bash
sudo systemctl status empire-pi.service
sudo systemctl restart empire-pi.service
sudo journalctl -u empire-pi.service -f
```

Ports:

- HTTP controller: `5000`
- WebSocket agent bus: `8765`

Health check:

```bash
curl http://localhost:5000/devices
curl http://pi5.local:5000/devices
```
