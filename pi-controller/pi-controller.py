#!/usr/bin/env python3
import asyncio
import json
import threading
from datetime import datetime

from flask import Flask, jsonify, request
import websockets

app = Flask(__name__)

devices = {}
agent_bus_clients = {}


@app.route("/register", methods=["POST"])
def register_device():
    data = request.json or {}
    device_id = data["name"]

    devices[device_id] = {
        "name": device_id,
        "ip": data.get("ip"),
        "role": data.get("role", "worker"),
        "models": data.get("models", []),
        "skills": data.get("skills", []),
        "status": "online",
        "last_seen": datetime.now().isoformat(),
    }

    print(f"[PI-CONTROLLER] Registered: {device_id} ({devices[device_id]['role']})")
    return jsonify({"status": "registered", "mesh_nodes": len(devices)})


@app.route("/devices", methods=["GET"])
def get_devices():
    enriched = []
    for name, device in devices.items():
        item = dict(device)
        item["bus_connected"] = name in agent_bus_clients
        enriched.append(item)
    return jsonify(enriched)


@app.route("/bus/clients", methods=["GET"])
def get_bus_clients():
    return jsonify({
        "clients": sorted(agent_bus_clients.keys()),
        "count": len(agent_bus_clients),
    })


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "registered_devices": len(devices),
        "bus_clients": len(agent_bus_clients),
    })


@app.route("/route_task", methods=["POST"])
def route_task():
    task = request.json or {}
    best_device = select_best_device(task.get("type", "general"))

    if not best_device:
        return jsonify({"error": "No suitable device"}), 503

    asyncio.run(send_to_device(best_device, task))
    return jsonify({"routed_to": best_device})


def select_best_device(task_type):
    scores = []

    for name, device in devices.items():
        score = 100
        role = device.get("role")
        models = device.get("models", [])

        if task_type == "security" and role == "security":
            score += 50
        elif task_type == "creative" and role == "creative":
            score += 50
        elif task_type == "coding" and any("dolphin-mixtral" in model for model in models):
            score += 50
        elif role == "coordinator":
            score += 10

        scores.append((name, score))

    scores.sort(key=lambda item: item[1], reverse=True)
    return scores[0][0] if scores else None


async def send_to_device(device_name, task):
    websocket = agent_bus_clients.get(device_name)
    if websocket:
        await websocket.send(json.dumps(task))


async def agent_bus(websocket):
    agent_id = None
    try:
        data = json.loads(await websocket.recv())
        agent_id = data["agent_id"]
        agent_bus_clients[agent_id] = websocket

        print(f"[AGENT-BUS] {agent_id} connected")

        async for message in websocket:
            await route_message(json.loads(message), agent_id)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        if agent_id:
            agent_bus_clients.pop(agent_id, None)


async def route_message(message, from_agent):
    target = message.get("target")
    if target:
        websocket = agent_bus_clients.get(target)
        if websocket:
            await websocket.send(json.dumps(message))
        return

    for agent_id, websocket in agent_bus_clients.items():
        if agent_id == from_agent:
            continue
        try:
            await websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosed:
            pass


def start_flask():
    app.run(host="0.0.0.0", port=5000)


async def main():
    print("[PI-CONTROLLER] Starting on port 5000 (HTTP) and 8765 (WebSocket)")
    flask_thread = threading.Thread(target=start_flask, daemon=True)
    flask_thread.start()

    async with websockets.serve(agent_bus, "0.0.0.0", 8765):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
