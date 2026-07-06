# Pi 5 Controller

This is the first controller for the NoxuOS AI Empire mesh. It accepts device registrations over HTTP and routes agent bus messages over WebSocket.

## Install On Raspberry Pi 5

```bash
sudo apt update
sudo apt install -y python3-pip
python3 -m pip install -r requirements.txt
python3 pi-controller.py
```

Ports:

- HTTP controller: `5000`
- WebSocket agent bus: `8765`

Health check:

```bash
curl http://localhost:5000/devices
```
