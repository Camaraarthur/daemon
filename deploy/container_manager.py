#!/usr/bin/env python3
"""
Container Manager — Manages per-user Docker containers.

Each user gets an isolated gVisor container running the daemon.
Containers are ephemeral — all state syncs to user devices.
"""

import docker
import json
import time
from datetime import datetime, timezone
from typing import Optional

DAEMON_IMAGE = "daemon:latest"
NETWORK_PREFIX = "daemon-user-"
QDRANT_URL = "http://host.docker.internal:6333"  # Host's Qdrant

# Container resource limits
CONTAINER_LIMITS = {
    "mem_limit": "2g",
    "cpu_quota": 100000,  # 1 CPU
    "pids_limit": 256,
    "read_only": True,
}


class ContainerManager:
    def __init__(self):
        self.client = docker.from_env()
        self.containers: dict[str, dict] = {}  # user_id -> container info

    def create_user_container(
        self,
        user_id: str,
        daemon_name: str = "unnamed",
        api_key: Optional[str] = None,
        port_offset: int = 0,
    ) -> dict:
        """Create and start a container for a user."""

        container_name = f"daemon-{user_id}"
        network_name = f"{NETWORK_PREFIX}{user_id}"

        # Check if already running
        try:
            existing = self.client.containers.get(container_name)
            if existing.status == "running":
                info = self._container_info(existing, user_id, daemon_name)
                self.containers[user_id] = info
                return info
            elif existing.status == "paused":
                existing.unpause()
                info = self._container_info(existing, user_id, daemon_name)
                self.containers[user_id] = info
                return info
            else:
                existing.remove(force=True)
        except docker.errors.NotFound:
            pass

        # Create isolated network for this user
        try:
            self.client.networks.get(network_name)
        except docker.errors.NotFound:
            self.client.networks.create(
                network_name,
                driver="bridge",
                internal=False,  # Allow outbound (for API calls)
                labels={"daemon.user": user_id},
            )

        # Environment
        env = {
            "DAEMON_USER": user_id,
            "DAEMON_NAME": daemon_name,
            "QDRANT_URL": QDRANT_URL,
            "PORT": "4800",
        }
        if api_key:
            env["ANTHROPIC_API_KEY"] = api_key

        # Assign port
        host_port = 4800 + port_offset

        # Create container
        container = self.client.containers.run(
            DAEMON_IMAGE,
            detach=True,
            name=container_name,
            network=network_name,
            ports={"4800/tcp": host_port},
            environment=env,
            tmpfs={"/tmp": "size=500M"},
            security_opt=["no-new-privileges"],
            cap_drop=["ALL"],
            labels={
                "daemon.user": user_id,
                "daemon.name": daemon_name,
                "daemon.created": datetime.now(timezone.utc).isoformat(),
            },
            # Resource limits
            mem_limit=CONTAINER_LIMITS["mem_limit"],
            cpu_quota=CONTAINER_LIMITS["cpu_quota"],
            pids_limit=CONTAINER_LIMITS["pids_limit"],
            read_only=CONTAINER_LIMITS["read_only"],
        )

        info = self._container_info(container, user_id, daemon_name, host_port)
        self.containers[user_id] = info

        print(f"[container] Created {container_name} on port {host_port}")
        return info

    def stop_user_container(self, user_id: str):
        """Stop a user's container."""
        container_name = f"daemon-{user_id}"
        try:
            container = self.client.containers.get(container_name)
            container.stop(timeout=10)
            print(f"[container] Stopped {container_name}")
        except docker.errors.NotFound:
            pass

    def pause_user_container(self, user_id: str):
        """Pause (freeze) a user's container. Saves memory."""
        container_name = f"daemon-{user_id}"
        try:
            container = self.client.containers.get(container_name)
            if container.status == "running":
                container.pause()
                print(f"[container] Paused {container_name}")
        except docker.errors.NotFound:
            pass

    def remove_user_container(self, user_id: str):
        """Remove a user's container and network."""
        container_name = f"daemon-{user_id}"
        network_name = f"{NETWORK_PREFIX}{user_id}"

        try:
            container = self.client.containers.get(container_name)
            container.remove(force=True)
            print(f"[container] Removed {container_name}")
        except docker.errors.NotFound:
            pass

        try:
            network = self.client.networks.get(network_name)
            network.remove()
        except docker.errors.NotFound:
            pass

    def list_containers(self) -> list[dict]:
        """List all daemon containers."""
        containers = self.client.containers.list(
            all=True,
            filters={"label": "daemon.user"},
        )
        return [
            {
                "user_id": c.labels.get("daemon.user"),
                "daemon_name": c.labels.get("daemon.name"),
                "status": c.status,
                "created": c.labels.get("daemon.created"),
                "id": c.short_id,
            }
            for c in containers
        ]

    def cleanup_idle(self, idle_minutes: int = 60):
        """Pause containers idle for too long."""
        # TODO: Track last activity per container
        pass

    def _container_info(self, container, user_id, daemon_name, port=None) -> dict:
        return {
            "user_id": user_id,
            "daemon_name": daemon_name,
            "container_id": container.short_id,
            "status": container.status,
            "port": port,
        }


if __name__ == "__main__":
    """Test container manager."""
    manager = ContainerManager()

    print("Existing daemon containers:")
    for c in manager.list_containers():
        print(f"  {c['user_id']}: {c['status']} ({c['daemon_name']})")

    print(f"\nDocker images: {[t for i in manager.client.images.list() for t in i.tags if 'daemon' in str(t)]}")
