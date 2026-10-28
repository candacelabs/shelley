"""Launch real embedded exe-scroll PTYs for the teardown integration test."""

import json
import os
import pty
import re
import select
import signal
import subprocess
import sys
import time
from pathlib import Path


root = Path(sys.argv[1])
binary = Path(__file__).resolve().parents[2] / "bin/shelley"
home = root / "home"
assert home.is_dir(), "globalSetup did not create private HOME"
(root / "terminals").mkdir(exist_ok=True)


def snapshot():
    rows = subprocess.check_output(
        ["ps", "-axo", "pid=,ppid=,pgid=,sess=,command="], text=True
    )
    return [
        (int(pid), int(ppid), int(pgid), sid, command)
        for line in rows.splitlines()
        if len(fields := line.strip().split(None, 4)) == 5
        for pid, ppid, pgid, sid, command in [fields]
    ]


def read_until(master, pattern):
    data = b""
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.05)[0]:
            data += os.read(master, 4096)
            match = re.search(pattern, data)
            if match:
                return match
    raise AssertionError(f"PTY did not produce {pattern!r}: {data[-500:]!r}")


def terminal(name, command=None):
    sock = str(root / "terminals" / f"{name}.sock")
    master, slave = pty.openpty()
    client = subprocess.Popen(
        [
            str(binary), "exe-scroll", sock, "--", "sh", "-c",
            'bash --login -c \'exec "${SHELL:-bash}" -i\'',
        ],
        stdin=slave, stdout=slave, stderr=slave, start_new_session=True,
        env={**os.environ, "HOME": str(home), "SHELL": "/bin/bash"},
    )
    os.close(slave)
    try:
        read_until(master, rb"[$#] ")
        if command:
            os.write(master, command)
            if name == "background":
                bg = int(read_until(master, rb"BG=(\d+)")[1])
            else:
                bg = None
        else:
            bg = None
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            rows = snapshot()
            servers = [p for p in rows if p[4].startswith(f"exe-scroll: session {root}/")
                       and f"/{name}.sock" in p[4]]
            if servers:
                server = servers[0][0]
                leaders = [p for p in rows if p[1] == server and p[0] == p[2]
                           and p[3] != servers[0][3]]
                if leaders:
                    leader = leaders[0][0]
                    session = leaders[0][3]
                    shell = next((p for p in rows if p[3] == session
                                  and p[4].endswith("/bash -i")), None)
                    jobs = [p for p in rows if p[3] == session and p[4] == "sleep 120"
                            and p[2] not in (leader, shell[2])] if shell else []
                    if shell and (name == "idle" or
                                  (name == "background" and any(p[0] == bg for p in jobs)) or
                                  (name == "foreground" and jobs)):
                        return dict(server=server, leader=leader, shell=shell[0],
                                    job=(bg if bg else jobs[0][0]) if jobs else None,
                                    job_group=jobs[0][2] if jobs else None)
            select.select([master], [], [], 0.05)
        raise AssertionError(f"{name} PTY command never started")
    finally:
        os.close(master)
        client.kill()
        client.wait(timeout=5)


try:
    idle = terminal("idle")
    background = terminal("background", b"sleep 120 & echo BG=$!\n")
    foreground = terminal("foreground", b"sleep 120\n")
    unrelated = subprocess.Popen(
        ["sleep", "120"], start_new_session=True, stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    print(json.dumps(dict(idle=idle, background=background, foreground=foreground,
                          unrelated=unrelated.pid)), flush=True)
except BaseException:
    # Sweep by the private namespace even if terminal() failed before it
    # could return its PIDs to the caller.
    rows = snapshot()
    servers = {p[0]: p for p in rows if p[4].startswith(f"exe-scroll: session {root}/")}
    sessions = {p[3] for p in rows if p[1] in servers and p[0] == p[2]
                and p[3] != servers[p[1]][3]}
    for group in {p[2] for p in rows if p[3] in sessions}:
        try:
            os.killpg(group, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for server in servers:
        try:
            os.kill(server, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if "unrelated" in locals():
        unrelated.kill()
    raise
