#!/usr/bin/env python3
import asyncio
import json

import websockets


clients = {}


async def agent_bus(websocket):
    agent_id = None
    try:
        data = json.loads(await websocket.recv())
        agent_id = data.get("agent_id")
        if not agent_id:
            await websocket.close()
            return

        clients[agent_id] = websocket
        print(f"[AGENT-BUS] {agent_id} connected")

        async for message in websocket:
            await route_message(json.loads(message), agent_id)
    finally:
        if agent_id:
            clients.pop(agent_id, None)


async def route_message(message, from_agent):
    target = message.get("target")
    if target:
        websocket = clients.get(target)
        if websocket:
            await websocket.send(json.dumps(message))
        return

    for agent_id, websocket in list(clients.items()):
        if agent_id == from_agent:
            continue
        try:
            await websocket.send(json.dumps(message))
        except websockets.exceptions.ConnectionClosed:
            clients.pop(agent_id, None)


async def main():
    print("[AGENT-BUS] Starting on ws://0.0.0.0:8765")
    async with websockets.serve(agent_bus, "0.0.0.0", 8765):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
