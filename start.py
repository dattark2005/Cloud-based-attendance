"""
Cloud-Based Attendance System -- Master Startup Script (start.py)

Services launched:
  [NODE+FACE+VOICE]  Node.js Backend + Face API (:8080) + Voice API (:8081)
  [FRONT]            Next.js Frontend  -> :3000
  [CAM]              Live Camera Sync  (optional, --camera flag)

Usage:
    python start.py            # starts all services
    python start.py --camera   # also starts live_camera_sync.py
"""
# Force UTF-8 output so box-drawing / emoji chars don't crash on Windows cp1252
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import subprocess
import threading
import sys
import os
import signal
import argparse
import time

# ── Resolve project root (same dir as this script) ──────────────────────────
ROOT = os.path.dirname(os.path.abspath(__file__))
VENV_PYTHON = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
BACKEND_DIR = os.path.join(ROOT, "backend")
FRONTEND_DIR = os.path.join(ROOT, "frontend")

# ── ANSI colours ─────────────────────────────────────────────────────────────
RESET  = "\033[0m"
BOLD   = "\033[1m"
COLORS = {
    "NODE" : "\033[96m",   # cyan
    "FACE" : "\033[93m",   # yellow
    "VOICE": "\033[95m",   # magenta
    "FRONT": "\033[92m",   # green
    "CAM"  : "\033[94m",   # blue
    "SYS"  : "\033[97m",   # white
}

def cprint(label: str, text: str):
    color = COLORS.get(label, RESET)
    for line in text.rstrip("\n").splitlines():
        print(f"{color}{BOLD}[{label}]{RESET} {line}", flush=True)

def stream_output(proc, label: str):
    """Read a process stream line-by-line and print with label prefix."""
    try:
        for line in iter(proc.stdout.readline, b""):
            cprint(label, line.decode("utf-8", errors="replace").rstrip())
    except Exception:
        pass

# ── Kill any process occupying a port (Windows) ───────────────────────────────
def free_port(port: int):
    """Kill whatever process (and its children) is holding the given port."""
    try:
        result = subprocess.run(
            f"netstat -ano | findstr \":{port} \"",
            shell=True, capture_output=True, text=True
        )
        seen = set()
        for line in result.stdout.splitlines():
            parts = line.split()
            if not parts or len(parts) < 5:
                continue
            # Exact match on local address column (index 1)
            if not parts[1].endswith(f":{port}"):
                continue
            pid = parts[-1]
            if pid and pid != "0" and pid not in seen:
                seen.add(pid)
                subprocess.run(
                    f"taskkill /PID {pid} /F /T",
                    shell=True, capture_output=True
                )
    except Exception:
        pass

def free_ports():
    """Free all ports used by our services before launch."""
    ports = [3000, 3001, 3002, 8000, 8080, 8081, 8082]
    cprint("SYS", f"Freeing ports {ports}...")
    for p in ports:
        free_port(p)
    # Also remove the stale Next.js dev lock file
    lock_path = os.path.join(FRONTEND_DIR, ".next", "dev", "lock")
    if os.path.exists(lock_path):
        try:
            os.remove(lock_path)
            cprint("SYS", "Removed stale Next.js dev lock")
        except Exception:
            pass
    time.sleep(1)   # let OS release ports

# ── Service definitions ───────────────────────────────────────────────────────
def build_services(with_camera: bool = False) -> list[dict]:
    services = [
        {
            "label": "NODE+FACE+VOICE",
            "cmd"  : ["npm", "run", "dev"],
            "cwd"  : BACKEND_DIR,
            "shell": True,
        },
        {
            "label": "FRONT",
            "cmd"  : ["npx", "next", "dev"],
            "cwd"  : FRONTEND_DIR,
            "shell": True,
        },
    ]
    if with_camera:
        services.append({
            "label": "CAM",
            "cmd"  : [VENV_PYTHON, os.path.join(ROOT, "live_camera_sync.py")],
            "cwd"  : ROOT,
            "shell": False,
        })
    return services

# ── Launch ────────────────────────────────────────────────────────────────────
processes: list[subprocess.Popen] = []

def launch_all(with_camera: bool):
    os.system("")   # enable ANSI on Windows

    # ── PRE-FLIGHT: kill any stale processes holding our ports ──
    free_ports()

    services = build_services(with_camera)

    banner = (
        f"\n{COLORS['SYS']}{BOLD}"
        f"\n====================================================="
        f"\n   Cloud-Based Attendance System -- Starting up"
        f"\n====================================================="
        f"\n  Frontend   ->  http://localhost:3000"
        f"\n  Backend    ->  http://localhost:3001"
        f"\n  Face API   ->  http://localhost:8082"
        f"\n  Voice API  ->  http://localhost:8081"
        f"\n====================================================="
        f"\n  Press Ctrl+C to stop all services"
        f"\n{RESET}"
    )
    print(banner)

    for svc in services:
        label = svc["label"]
        cprint("SYS", f"Launching [{label}]  →  {' '.join(svc['cmd'])}")
        proc = subprocess.Popen(
            svc["cmd"],
            cwd    = svc["cwd"],
            stdout = subprocess.PIPE,
            stderr = subprocess.STDOUT,
            shell  = svc.get("shell", False),
        )
        processes.append(proc)
        thread = threading.Thread(
            target=stream_output,
            args=(proc, label),
            daemon=True,
        )
        thread.start()
        time.sleep(0.5)  # stagger starts slightly

    # Services that MUST stay alive — if they exit, stop everything
    # The voice service (embedded inside npm run dev via concurrently) is non-critical:
    # if it crashes, NODE and FACE keep running fine.
    critical_indices = list(range(len(processes)))  # all processes are monitored

    cprint("SYS", "All services launched. Waiting... (Ctrl+C to stop)\n")

    # Keep alive until a process exits or Ctrl+C
    try:
        while True:
            for i, proc in enumerate(processes):
                ret = proc.poll()
                if ret is not None:
                    svc_label = services[i]["label"] if i < len(services) else f"#{i}"
                    if ret == 0:
                        cprint("SYS", f"ℹ  [{svc_label}] exited cleanly (code 0). Stopping all.")
                        shutdown()
                        return
                    else:
                        cprint("SYS", f"⚠  [{svc_label}] exited with code {ret}. Stopping all services.")
                        shutdown()
                        return
            time.sleep(1)
    except KeyboardInterrupt:
        print()
        cprint("SYS", "Ctrl+C received — shutting down all services...")
        shutdown()

def shutdown():
    """Kill all launched processes including their entire child process trees."""
    for proc in processes:
        try:
            if proc.poll() is None:
                # taskkill /T kills the entire tree (npm + Node + Python children)
                subprocess.run(
                    f"taskkill /PID {proc.pid} /T /F",
                    shell=True, capture_output=True
                )
        except Exception:
            pass
    # Final fallback — free ports directly
    time.sleep(1)
    free_ports()
    cprint("SYS", "All services stopped. Goodbye!")

# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Register signal handler for clean exit on Windows
    signal.signal(signal.SIGINT,  lambda *_: (_ for _ in ()).throw(KeyboardInterrupt()))
    signal.signal(signal.SIGTERM, lambda *_: shutdown())

    launch_all(with_camera=False)

