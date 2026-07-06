#!/usr/bin/env python3
import asyncio
import json
import os
import time

import websockets


class HardwareController:
    def __init__(self, url=None):
        self.url = url or os.getenv("EMPIRE_WS", "ws://pi5.local:8765")
        self.approval_required = os.getenv("HARDWARE_APPROVAL_REQUIRED", "true").lower() != "false"
        self.ws = None

    async def connect(self):
        self.ws = await websockets.connect(self.url)
        await self.ws.send(json.dumps({
            "type": "register",
            "agent_id": "hardware_controller",
            "role": "engineering",
        }))
        print("[HARDWARE] Connected to agent bus")

    async def execute(self, device, action):
        if self.approval_required and not self.request_approval(device, action):
            print("[HARDWARE] Command cancelled")
            return False

        if not self.ws:
            await self.connect()

        await self.ws.send(json.dumps({
            "type": "command",
            "target": device,
            "command": action,
            "approved": True,
            "timestamp": time.time(),
        }))
        return True

    def request_approval(self, device, action):
        answer = input(f"[HARDWARE APPROVAL] Execute '{action}' on '{device}'? (y/n): ")
        return answer.strip().lower() == "y"


async def main():
    controller = HardwareController()
    await controller.connect()
    print("[HARDWARE] Ready. Import this module or call execute() from a supervised command.")


if __name__ == "__main__":
    asyncio.run(main())
