#!/usr/bin/env python3
"""
MCP Server — Custom tools for the daemon.
Provides SSH, device listing, sensor reading, audio, and display tools.
Runs as a stdio MCP server, loaded by Claude Code via --mcp-config.
"""

import asyncio
import json
import subprocess
import sys
import time
from typing import Any

# Simple MCP stdio server implementation
# Protocol: JSON-RPC 2.0 over stdin/stdout


TOOLS_PHONE = {
    "name": "phone_command",
    "description": "Send a command to a connected Android phone via the daemon app. The phone runs a background service that can: take_photo, get_location, read_sensors, get_battery, get_device_info, send_notification, list_files, read_file, bluetooth_scan. Returns JSON result.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "Command type: take_photo, get_location, read_sensors, get_battery, get_device_info, send_notification, list_files, read_file",
                "enum": ["take_photo", "get_location", "read_sensors", "get_battery", "get_device_info", "send_notification", "list_files", "read_file"],
            },
            "params": {
                "type": "object",
                "description": "Optional parameters (e.g. {\"path\": \"/storage/emulated/0/DCIM\"} for list_files, {\"title\": \"hello\", \"body\": \"world\"} for send_notification)",
            },
            "device_id": {
                "type": "string",
                "description": "Device ID (default: Pixel 8 Pro)",
                "default": "Pixel 8 Pro",
            },
        },
        "required": ["command"],
    },
}

TOOLS_ESP32 = {
    "name": "esp32_command",
    "description": "Send a MicroPython command to the ESP32 daemon key over WiFi via the phone. The ESP32 has a ST7789 display (240x280) and distance sensor. Display: tft.fill(0), tft.text(font, 'text', x, y, color), tft.fill_rect(x, y, w, h, color). Colors: st7789.RED, st7789.WHITE, st7789.BLACK. Sensor: read_distance() returns cm. Goes through phone's WiFi TCP to ESP32 REPL on port 8266.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "MicroPython command to execute on the ESP32 REPL",
            },
        },
        "required": ["command"],
    },
}

TOOL_PLOT_WEB = {
    "name": "plot_sensor_web",
    "description": "Start or stop streaming live ESP32 sensor data to the daemon's public web page (my.daemon.page). The canvas will automatically appear/disappear. Actions: 'start' begins plotting distance sensor every 2s, 'stop' hides the canvas, 'once' does a single read and push.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "description": "start, stop, or once",
                "enum": ["start", "stop", "once"],
            },
        },
        "required": ["action"],
    },
}

TOOL_PLOT_ESP32 = {
    "name": "plot_sensor_esp32",
    "description": "Display live sensor data on the ESP32's screen in a nice red graph/number display. Actions: 'start' begins updating the display with distance readings, 'stop' clears the display, 'once' shows current reading.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {
                "type": "string",
                "description": "start, stop, or once",
                "enum": ["start", "stop", "once"],
            },
        },
        "required": ["action"],
    },
}

TOOL_PUSH_WEB = {
    "name": "push_to_web",
    "description": "Push arbitrary content to the daemon's public web page canvas. Can push text, sensor data, or clear the canvas.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "type": {
                "type": "string",
                "description": "Content type: 'text', 'sensor', or 'clear'",
                "enum": ["text", "sensor", "clear"],
            },
            "text": {
                "type": "string",
                "description": "Text to display (for type=text)",
            },
            "distance": {
                "type": "number",
                "description": "Distance value in cm (for type=sensor)",
            },
        },
        "required": ["type"],
    },
}

TOOLS = [
    {
        "name": "ssh_run",
        "description": "Run a command on a remote device via SSH. Available devices: arturito (Linux server), msi (Windows laptop), pixel (Android/Termux). Returns stdout+stderr.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "host": {
                    "type": "string",
                    "description": "SSH host alias: 'arturito', 'msi', or 'pixel'",
                    "enum": ["arturito", "msi", "pixel"],
                },
                "command": {
                    "type": "string",
                    "description": "Command to execute on the remote device",
                },
                "timeout": {
                    "type": "integer",
                    "description": "Timeout in seconds (default 30)",
                    "default": 30,
                },
            },
            "required": ["host", "command"],
        },
    },
    {
        "name": "list_devices",
        "description": "List all known devices in the Tailscale mesh with their status (online/offline).",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "device_info",
        "description": "Get detailed info about a specific device: OS, uptime, disk, memory, network.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "host": {
                    "type": "string",
                    "description": "SSH host alias",
                    "enum": ["arturito", "msi", "pixel"],
                },
            },
            "required": ["host"],
        },
    },
    {
        "name": "list_usb_devices",
        "description": "List USB devices connected to a host.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "host": {
                    "type": "string",
                    "description": "SSH host alias (default: local machine)",
                    "default": "arturito",
                },
            },
        },
    },
    TOOLS_PHONE,
    TOOLS_ESP32,
    TOOL_PLOT_WEB,
    TOOL_PLOT_ESP32,
    TOOL_PUSH_WEB,
    {
        "name": "scan_i2c",
        "description": "Scan I2C bus for connected sensors. Returns detected addresses and likely device types.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "host": {
                    "type": "string",
                    "description": "SSH host alias where I2C devices are connected",
                    "default": "arturito",
                },
                "bus": {
                    "type": "integer",
                    "description": "I2C bus number (default 1 for Raspberry Pi)",
                    "default": 1,
                },
            },
        },
    },
]

# Known I2C sensor addresses for auto-identification
I2C_SENSOR_DB = {
    "0x3c": "SSD1306/SSD1315 OLED Display",
    "0x3d": "SSD1306 OLED Display (alt addr)",
    "0x40": "INA219 Current Sensor / HDC1080 Humidity",
    "0x44": "SHT41/SHT45 Temp+Humidity",
    "0x48": "ADS1115 ADC / TMP102 Temperature",
    "0x50": "AT24C EEPROM",
    "0x57": "MAX30102 Heart Rate",
    "0x68": "MPU6050 IMU / DS3231 RTC",
    "0x69": "MPU6050 IMU (alt addr)",
    "0x76": "BME280/BMP280 (SDO=GND)",
    "0x77": "BME280/BMP280 (SDO=VCC) / BMP180",
}

# Device-specific info commands
DEVICE_INFO_COMMANDS = {
    "arturito": "echo '=== OS ===' && uname -a && echo '=== Uptime ===' && uptime && echo '=== Memory ===' && free -h && echo '=== Disk ===' && df -h / && echo '=== Network ===' && hostname -I",
    "msi": 'systeminfo | findstr /B /C:"OS Name" /C:"OS Version" /C:"System Manufacturer" /C:"Total Physical Memory" && echo === Uptime === && net stats workstation | findstr "since"',
    "pixel": "uname -a && uptime && free -h && df -h /data 2>/dev/null || df -h /",
}


def run_ssh(host: str, command: str, timeout: int = 30) -> dict:
    """Execute a command on a remote host via SSH. Local commands for arturito."""
    try:
        if host == "arturito":
            # Local execution — no SSH needed
            result = subprocess.run(
                ["bash", "-c", command],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        else:
            result = subprocess.run(
                ["ssh", host, command],
                capture_output=True,
                text=True,
                timeout=timeout,
            )
        output = result.stdout
        if result.stderr:
            output += f"\n[stderr]: {result.stderr}"
        return {"success": True, "output": output.strip(), "exit_code": result.returncode}
    except subprocess.TimeoutExpired:
        return {"success": False, "output": f"Command timed out after {timeout}s", "exit_code": -1}
    except Exception as e:
        return {"success": False, "output": str(e), "exit_code": -1}


def check_device_online(host: str) -> bool:
    """Quick check if a device is reachable via SSH."""
    try:
        result = subprocess.run(
            ["ssh", "-o", "ConnectTimeout=3", host, "echo ok"],
            capture_output=True, text=True, timeout=5,
        )
        return result.returncode == 0
    except:
        return False


async def handle_tool_call(name: str, arguments: dict) -> list[dict]:
    """Execute a tool and return MCP-formatted content."""

    if name == "phone_command":
        command = arguments["command"]
        params = arguments.get("params", {})
        device_id = arguments.get("device_id", "Pixel 8 Pro")

        # Send command to phone via WebSocket server HTTP API
        import urllib.request
        import json as json_mod

        request_id = f"req-{int(time.time() * 1000)}"
        payload = json_mod.dumps({
            "device_id": device_id,
            "command": {
                "type": command,
                "request_id": request_id,
                **params,
            }
        }).encode()

        try:
            # First check if device is connected
            health_req = urllib.request.Request("http://localhost:4801/health")
            health_resp = urllib.request.urlopen(health_req, timeout=3)
            health = json_mod.loads(health_resp.read().decode())
            connected_ids = [d["id"] for d in health.get("devices", []) if d.get("connected")]
            if device_id not in connected_ids:
                return [{"type": "text", "text": f"**Phone not connected.** The daemon app isn't running on {device_id}. Connected devices: {', '.join(connected_ids) or 'none'}. Try SSH to pixel instead: ssh pixel 'command'"}]

            req = urllib.request.Request(
                "http://localhost:4801/command",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=10)
            result = json_mod.loads(resp.read().decode())
            return [{"type": "text", "text": f"**Phone ({device_id}):**\n```json\n{json_mod.dumps(result, indent=2)}\n```"}]
        except Exception as e:
            return [{"type": "text", "text": f"**Phone error:** {e}\n\nIs the daemon app running on the phone? Check WebSocket: http://localhost:4801/health"}]

    elif name == "esp32_command":
        command = arguments["command"]
        # Send via phone's WebSocket → TCP to ESP32
        import urllib.request
        import json as json_mod
        try:
            payload = json_mod.dumps({
                "device_id": "Pixel 8 Pro",
                "command": {
                    "type": "esp32_command",
                    "ip": "10.27.241.196",
                    "port": 8266,
                    "command": command + "\n",
                }
            }).encode()
            req = urllib.request.Request(
                "http://localhost:4801/command",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=15)
            result = json_mod.loads(resp.read().decode())
            return [{"type": "text", "text": f"**ESP32:**\n```\n{json_mod.dumps(result, indent=2)}\n```"}]
        except Exception as e:
            return [{"type": "text", "text": f"**ESP32 error:** {e}. REPL may be down — try reading via HTTP port 8268 instead."}]

    elif name == "plot_sensor_web":
        action = arguments["action"]
        import urllib.request
        import json as json_mod
        import sqlite3
        try:
            conn = sqlite3.connect("/home/arthur/daemon/data/users.db")
            token = conn.execute("SELECT token FROM sessions LIMIT 1").fetchone()[0]
            conn.close()
            req = urllib.request.Request(
                f"http://localhost:4800/api/sensor-stream?action={action}",
                headers={"Cookie": f"daemon_token={token}"},
            )
            resp = urllib.request.urlopen(req, timeout=15)
            result = json_mod.loads(resp.read().decode())
            if action == "start":
                return [{"type": "text", "text": f"**Sensor stream started** on my.daemon.page. The canvas will appear with live distance data updating every 2 seconds."}]
            elif action == "stop":
                return [{"type": "text", "text": f"**Sensor stream stopped.** Canvas hidden on my.daemon.page."}]
            else:
                return [{"type": "text", "text": f"**Single read:** {json_mod.dumps(result)}"}]
        except Exception as e:
            return [{"type": "text", "text": f"**Stream error:** {e}"}]

    elif name == "plot_sensor_esp32":
        action = arguments["action"]
        if action == "stop":
            # Clear ESP32 display
            result = await handle_tool_call("esp32_command", {"command": "tft.fill(0)"})
            return [{"type": "text", "text": "**ESP32 display cleared.**"}]
        # Read sensor and display on ESP32
        try:
            # Read via HTTP
            read_result = subprocess.run(
                ["/home/arthur/daemon/server/read_sensor.sh"],
                capture_output=True, text=True, timeout=10,
                env={**dict(__import__('os').environ), "HOME": "/home/arthur"},
            )
            distance = float(read_result.stdout.strip())
        except:
            distance = -1

        if distance > 0:
            # Send display command: clear screen, show big red number
            display_cmd = f'tft.fill(0); tft.text(font, "{distance:.1f}", 10, 60, st7789.RED); tft.text(font, "cm", 10, 140, st7789.color565(80,80,80))'
            result = await handle_tool_call("esp32_command", {"command": display_cmd})
            msg = f"**ESP32 display:** {distance:.1f} cm"
            if action == "start":
                msg += "\n\n(Note: for continuous updates on ESP32, the firmware handles its own display loop. Single update shown.)"
            return [{"type": "text", "text": msg}]
        else:
            return [{"type": "text", "text": f"**Sensor read failed** (got {distance}). ESP32 may be unreachable."}]

    elif name == "push_to_web":
        content_type = arguments["type"]
        import urllib.request
        import json as json_mod
        import sqlite3
        try:
            conn = sqlite3.connect("/home/arthur/daemon/data/users.db")
            token = conn.execute("SELECT token FROM sessions LIMIT 1").fetchone()[0]
            conn.close()
            payload = {"type": content_type}
            if content_type == "text":
                payload["text"] = arguments.get("text", "")
            elif content_type == "sensor":
                payload["distance"] = arguments.get("distance", 0)
                payload["timestamp"] = int(time.time() * 1000)
            data = json_mod.dumps(payload).encode()
            req = urllib.request.Request(
                "http://localhost:4800/api/stream-push",
                data=data,
                headers={"Content-Type": "application/json", "Cookie": f"daemon_token={token}"},
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=5)
            return [{"type": "text", "text": f"**Pushed to web:** {content_type}"}]
        except Exception as e:
            return [{"type": "text", "text": f"**Push error:** {e}"}]

    elif name == "ssh_run":
        host = arguments["host"]
        command = arguments["command"]
        timeout = arguments.get("timeout", 30)
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: run_ssh(host, command, timeout)
        )
        text = f"**{host}** (exit {result['exit_code']}):\n```\n{result['output']}\n```"
        return [{"type": "text", "text": text}]

    elif name == "list_devices":
        devices = {
            "arturito": {"ip": "100.124.245.114", "os": "Linux", "user": "arthur", "port": 22},
            "msi": {"ip": "100.90.175.87", "os": "Windows", "user": "tutuc", "port": 22},
            "pixel": {"ip": "100.126.71.26", "os": "Android/Termux", "user": "arthur", "port": 8022},
            "esp32": {"ip": "192.168.1.191", "os": "MicroPython", "user": "n/a", "port": 8266},
        }
        lines = ["| Device | IP | OS | Status |", "|--------|-----|-----|--------|"]
        for name_d, info in devices.items():
            online = await asyncio.get_event_loop().run_in_executor(
                None, lambda n=name_d: check_device_online(n)
            )
            status = "Online" if online else "Offline"
            lines.append(f"| {name_d} | {info['ip']} | {info['os']} | {status} |")
        return [{"type": "text", "text": "\n".join(lines)}]

    elif name == "device_info":
        host = arguments["host"]
        cmd = DEVICE_INFO_COMMANDS.get(host, "uname -a && uptime && free -h && df -h /")
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: run_ssh(host, cmd)
        )
        return [{"type": "text", "text": f"**{host} info:**\n```\n{result['output']}\n```"}]

    elif name == "list_usb_devices":
        host = arguments.get("host", "arturito")
        if host == "msi":
            cmd = "powershell \"Get-PnpDevice -Class USB -Status OK | Format-Table -Property FriendlyName,InstanceId -AutoSize\""
        else:
            cmd = "lsusb 2>/dev/null || echo 'lsusb not available'"
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: run_ssh(host, cmd)
        )
        return [{"type": "text", "text": f"**USB devices on {host}:**\n```\n{result['output']}\n```"}]

    elif name == "scan_i2c":
        host = arguments.get("host", "arturito")
        bus = arguments.get("bus", 1)
        cmd = f"i2cdetect -y {bus} 2>/dev/null || echo 'i2cdetect not available (install i2c-tools)'"
        result = await asyncio.get_event_loop().run_in_executor(
            None, lambda: run_ssh(host, cmd)
        )
        # Parse detected addresses
        detected = []
        for line in result["output"].split("\n"):
            for token in line.split():
                if len(token) == 2 and token != "--" and token != "UU":
                    try:
                        addr = int(token, 16)
                        hex_addr = f"0x{addr:02x}"
                        sensor_name = I2C_SENSOR_DB.get(hex_addr, "Unknown device")
                        detected.append(f"  {hex_addr}: {sensor_name}")
                    except ValueError:
                        pass

        text = f"**I2C bus {bus} on {host}:**\n```\n{result['output']}\n```"
        if detected:
            text += f"\n\n**Detected sensors:**\n" + "\n".join(detected)
        return [{"type": "text", "text": text}]

    return [{"type": "text", "text": f"Unknown tool: {name}"}]


# ── MCP stdio protocol handler ──────────────────────────────────────

async def handle_request(request: dict) -> dict:
    """Handle a JSON-RPC 2.0 request."""
    method = request.get("method", "")
    req_id = request.get("id")
    params = request.get("params", {})

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "daemon-tools", "version": "0.1.0"},
            },
        }

    elif method == "notifications/initialized":
        return None  # No response for notifications

    elif method == "tools/list":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": TOOLS},
        }

    elif method == "tools/call":
        tool_name = params.get("name", "")
        arguments = params.get("arguments", {})
        content = await handle_tool_call(tool_name, arguments)
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"content": content, "isError": False},
        }

    else:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }


async def main():
    """MCP stdio server main loop."""
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await asyncio.get_event_loop().connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        try:
            line = await reader.readline()
            if not line:
                break
            line = line.decode().strip()
            if not line:
                continue

            request = json.loads(line)
            response = await handle_request(request)

            if response is not None:
                sys.stdout.write(json.dumps(response) + "\n")
                sys.stdout.flush()

        except json.JSONDecodeError:
            continue
        except Exception as e:
            sys.stderr.write(f"[daemon-tools] Error: {e}\n")
            sys.stderr.flush()


if __name__ == "__main__":
    asyncio.run(main())
