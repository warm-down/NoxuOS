#!/usr/bin/env python3
"""Supervised Raspberry Pi GPIO command handler.

This module is intentionally conservative: commands must be allowlisted, and
physical actions require approval unless the caller explicitly passes an
approved command from the controller layer.
"""

import os
from dataclasses import dataclass


ALLOWLIST = {"led_on", "led_off", "get_status"}
APPROVAL_REQUIRED = os.getenv("HARDWARE_APPROVAL_REQUIRED", "true").lower() != "false"


@dataclass
class HardwareCommand:
    device: str
    action: str
    approved: bool = False


class HardwareGPIO:
    def __init__(self):
        self.available = False
        try:
            import RPi.GPIO as GPIO  # type: ignore

            self.GPIO = GPIO
            self.available = True
        except Exception:
            self.GPIO = None

    def execute(self, command: HardwareCommand):
        if command.action not in ALLOWLIST:
            return {"ok": False, "error": f"Action '{command.action}' is not allowlisted"}

        if APPROVAL_REQUIRED and not command.approved:
            return {
                "ok": False,
                "approval_required": True,
                "device": command.device,
                "action": command.action,
            }

        if not self.available:
            return {
                "ok": True,
                "simulated": True,
                "device": command.device,
                "action": command.action,
            }

        # Real GPIO mappings should be configured per device before enabling.
        return {
            "ok": True,
            "simulated": True,
            "message": "GPIO library detected, but no pin map is configured yet.",
        }


if __name__ == "__main__":
    gpio = HardwareGPIO()
    print(gpio.execute(HardwareCommand(device="status", action="get_status", approved=True)))
