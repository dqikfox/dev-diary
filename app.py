"""DEV DIARY — Hitchy's personal project and work log for THRONE.

A local-first control surface for the whole estate: every project with its
links, its launcher and the machine it lives on; a calendar of the work
actually done each day; the remaining work and its deadlines; the notes;
the configuration inventory; the connected devices; and the machine's own
vitals.

It is deliberately dependency-light: FastAPI and psutil are already on the
box in the Hermes virtual environment, and nothing else is required.

SECURITY
--------
The Secure view shows the INVENTORY of credentials - service, username,
where the value lives - and never the value. Values are shown as #######
and the real contents live in "secure details.md" beside this file, which
is excluded from git and is never served over HTTP.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import psutil

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
STATIC = ROOT / "static"
SECRET_FILE = ROOT / "secure details.md"

PORT = int(os.environ.get("DEV_DIARY_PORT", "8530"))
TAILSCALE = r"C:\Program Files\Tailscale\tailscale.exe"

app = FastAPI(title="Dev Diary", version="1.0.0")

# the executor used for the live health probes
POOL = ThreadPoolExecutor(max_workers=12, thread_name_prefix="probe")


# ---------------------------------------------------------------- storage


def _read(name, default):
    p = DATA / name
    if not p.exists():
        return default
    try:
        return json.loads(p.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        return default


def _write(name, obj):
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = DATA / (name + ".tmp")
    tmp.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(DATA / name)


def _read_text(name, default=""):
    p = DATA / name
    return p.read_text(encoding="utf-8", errors="replace") if p.exists() else default


def _write_text(name, text):
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / name).write_text(text, encoding="utf-8")


# ---------------------------------------------------------------- probes


def probe(url: str, timeout: float = 4.0) -> dict:
    """A health URL that answers with a body. A TCP port is not health."""
    import urllib.request
    import urllib.error
    t0 = time.time()
    if not url:
        return {"state": "none", "ms": 0, "code": None, "detail": "no health url"}
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "dev-diary/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(4096).decode("utf-8", "replace")
            ms = int((time.time() - t0) * 1000)
            ok = r.status == 200 and body.strip() != ""
            return {"state": "up" if ok else "degraded", "ms": ms, "code": r.status,
                    "detail": body[:180].replace("\n", " ")}
    except urllib.error.HTTPError as e:
        ms = int((time.time() - t0) * 1000)
        return {"state": "degraded", "ms": ms, "code": e.code, "detail": "HTTP %s" % e.code}
    except Exception as e:
        ms = int((time.time() - t0) * 1000)
        return {"state": "down", "ms": ms, "code": None, "detail": type(e).__name__}


def launch(path: str, health: str = "", wait: int = 45) -> dict:
    """Run a launcher, detached, and watch for the service to come up.

    A launcher is never killed on failure: the operator's own script owns
    its own lifecycle, and this only reports what happened.
    """
    p = Path(path)
    if not p.exists():
        return {"ok": False, "detail": "the launcher is not at %s" % path}
    flags = 0
    if os.name == "nt":
        flags = (getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
                 | getattr(subprocess, "DETACHED_PROCESS", 0))
    try:
        proc = subprocess.Popen(
            [str(p)] if p.suffix.lower() in (".cmd", ".bat") else ["cmd", "/c", str(p)],
            cwd=str(p.parent), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL, creationflags=flags,
            env={k: v for k, v in os.environ.items()
                 if k not in ("PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP", "VIRTUAL_ENV")})
    except Exception as e:
        return {"ok": False, "detail": "the launcher failed to start: %s" % e}
    result = {"ok": True, "detail": "the launcher started", "pid": proc.pid, "up": None}
    if health:
        deadline = time.time() + wait
        while time.time() < deadline:
            time.sleep(2)
            st = probe(health, timeout=3)
            if st["state"] == "up":
                result["up"] = True
                result["detail"] = "the service answered in %d ms" % st["ms"]
                return result
        result["up"] = False
        result["detail"] = "the launcher ran but the service did not answer within %ds" % wait
    return result


# ---------------------------------------------------------------- system


def system_stats() -> dict:
    out = {"host": os.environ.get("COMPUTERNAME", "THRONE"),
           "uptime_s": int(time.time() - psutil.boot_time())}
    try:
        out["cpu"] = {"percent": psutil.cpu_percent(interval=0.25),
                      "cores": psutil.cpu_count(logical=True),
                      "physical": psutil.cpu_count(logical=False),
                      "load": [round(x, 2) for x in psutil.getloadavg()] if os.name != "nt" else None}
    except Exception as e:
        out["cpu"] = {"error": str(e)}
    try:
        vm = psutil.virtual_memory()
        out["ram"] = {"total": vm.total, "used": vm.used, "available": vm.available,
                      "percent": vm.percent}
    except Exception as e:
        out["ram"] = {"error": str(e)}
    disks = []
    for part in ("C:\\", "D:\\", "E:\\", "F:\\", "Q:\\"):
        if not os.path.exists(part):
            continue
        try:
            u = shutil.disk_usage(part)
            disks.append({"drive": part, "total": u.total, "used": u.used, "free": u.free,
                          "percent": round(u.used / u.total * 100, 1)})
        except Exception:
            pass
    out["disks"] = disks
    gpu = None
    nvsmi = shutil.which("nvidia-smi") or r"C:\Windows\System32\nvidia-smi.exe"
    if Path(nvsmi).exists():
        try:
            r = subprocess.run([nvsmi, "--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu",
                                "--format=csv,noheader,nounits"], capture_output=True, text=True,
                               timeout=20)
            rows = [x.strip() for x in (r.stdout or "").splitlines() if x.strip()]
            if rows:
                f = [c.strip() for c in rows[0].split(",")]
                gpu = {"name": f[0], "vram_total_mb": int(f[1]), "vram_used_mb": int(f[2]),
                       "util_percent": int(f[3]), "temp_c": int(f[4])}
        except Exception as e:
            gpu = {"error": str(e)}
    out["gpu"] = gpu
    out["processes"] = len(psutil.pids())
    out["uptime_human"] = str(timedelta(seconds=out["uptime_s"])).rsplit(".", 1)[0]
    return out


def tailnet() -> dict:
    """The tailnet peers, and the machines this host can reach."""
    if not Path(TAILSCALE).exists():
        return {"peers": [], "note": "the tailscale client is not at %s" % TAILSCALE}
    try:
        r = subprocess.run([TAILSCALE, "status", "--json"], capture_output=True, text=True,
                           timeout=25)
        d = json.loads(r.stdout)
    except Exception as e:
        return {"peers": [], "note": "the tailnet query failed: %s" % e}
    peers = []
    for v in (d.get("Peer") or {}).values():
        name = " ".join(v.get("HostName", "").split())
        if not name or name.startswith("funnel-"):
            continue
        ips = v.get("TailscaleIPs") or []
        peers.append({
            "name": name,
            "ip": ips[0] if ips else "",
            "os": v.get("OS", ""),
            "online": bool(v.get("Online")),
            "last_seen": v.get("LastSeen", ""),
            "tags": v.get("Tags") or [],
            "machine": "THRONE" if name.upper() == "THRONE" else name,
        })
    peers.sort(key=lambda p: (not p["online"], p["name"].lower()))
    self_ = d.get("Self") or {}
    return {"peers": peers, "self": {"name": self_.get("HostName", ""),
                                     "ip": (self_.get("TailscaleIPs") or [""])[0],
                                     "os": self_.get("OS", "")}}


# ---------------------------------------------------------------- routes


@app.get("/api/health")
def health():
    return {"service": "devdiary", "status": "ok", "version": app.version,
            "time": datetime.now().isoformat(timespec="seconds")}


@app.get("/api/projects")
def projects():
    reg = _read("projects.json", {"projects": []})
    items = reg.get("projects", [])

    def one(p):
        svc = p.get("service") or {}
        # a hosted project is checked at its public address; a local one is
        # checked on its own port. Probing a local port for a site that only
        # exists on GitHub Pages would report a healthy project as DOWN.
        health_url = svc.get("health") or p.get("public_health") or ""
        st = probe(health_url, timeout=6.0) if health_url else {
            "state": "none", "ms": 0, "code": None, "detail": "not a running service"}
        out = dict(p)
        out["status"] = st
        out["launcher_exists"] = bool(p.get("launcher")) and Path(p["launcher"]).exists()
        out["path_exists"] = bool(p.get("path")) and Path(p["path"]).exists()
        return out

    return {"generated": reg.get("generated"), "projects": list(POOL.map(one, items))}


@app.post("/api/projects/{pid}/launch")
def projects_launch(pid: str):
    reg = _read("projects.json", {"projects": []})
    for p in reg.get("projects", []):
        if p.get("id") == pid:
            l = p.get("launcher")
            if not l:
                raise HTTPException(400, "this project has no launcher")
            svc = p.get("service") or {}
            return launch(l, svc.get("health", ""))
    raise HTTPException(404, "no such project")


@app.get("/api/todo")
def todo():
    return _read("todo.json", {"items": []})


@app.post("/api/todo")
async def todo_set(payload: dict):
    d = _read("todo.json", {"items": []})
    items = d.get("items", [])
    action = payload.get("action", "add")
    if action == "add":
        items.append({
            "id": payload.get("id") or ("t%d" % int(time.time() * 1000)),
            "title": (payload.get("title") or "").strip(),
            "project": payload.get("project") or "",
            "status": payload.get("status") or "open",
            "priority": payload.get("priority") or "normal",
            "due": payload.get("due") or "",
            "notes": payload.get("notes") or "",
            "created": date.today().isoformat(),
        })
    elif action == "update":
        for it in items:
            if it.get("id") == payload.get("id"):
                for k in ("title", "status", "priority", "due", "notes", "project"):
                    if k in payload and payload[k] is not None:
                        it[k] = payload[k]
                it["updated"] = date.today().isoformat()
    elif action == "delete":
        items = [i for i in items if i.get("id") != payload.get("id")]
    d["items"] = items
    _write("todo.json", d)
    return d


@app.get("/api/diary")
def diary_list():
    d = _read("worklog.json", {"days": {}})
    days = []
    for k, v in sorted(d.get("days", {}).items(), reverse=True):
        days.append({"date": k, "summary": v.get("summary", ""),
                     "work": v.get("work", []), "deadlines": v.get("deadlines", []),
                     "count": len(v.get("work", []))})
    return {"days": days, "notes": _list_notes()}


def _list_notes():
    nd = DATA / "notes"
    if not nd.is_dir():
        return []
    out = []
    for f in sorted(nd.glob("*.md"), reverse=True):
        out.append({"name": f.name, "title": f.stem.replace("-", " "),
                    "size": f.stat().st_size})
    return out


@app.get("/api/diary/day/{day}")
def diary_day(day: str):
    d = _read("worklog.json", {"days": {}})
    v = d.get("days", {}).get(day)
    if v is None:
        raise HTTPException(404, "no record for %s" % day)
    return {"date": day, **v}


@app.post("/api/diary/day/{day}")
async def diary_set(day: str, payload: dict):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day):
        raise HTTPException(400, "the date must be YYYY-MM-DD")
    d = _read("worklog.json", {"days": {}})
    rec = d.setdefault("days", {}).setdefault(day, {"summary": "", "work": [], "deadlines": []})
    if "summary" in payload:
        rec["summary"] = payload["summary"]
    if "work" in payload:
        rec["work"] = payload["work"]
    if "deadlines" in payload:
        rec["deadlines"] = payload["deadlines"]
    rec["updated"] = datetime.now().isoformat(timespec="seconds")
    _write("worklog.json", d)
    return {"date": day, **rec}


@app.get("/api/diary/note/{name}")
def diary_note(name: str):
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "bad note name")
    p = DATA / "notes" / name
    if not p.exists():
        raise HTTPException(404, "no such note")
    return {"name": name, "text": p.read_text(encoding="utf-8", errors="replace")}


@app.post("/api/diary/note/{name}")
async def diary_note_set(name: str, payload: dict):
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "bad note name")
    (DATA / "notes").mkdir(parents=True, exist_ok=True)
    (DATA / "notes" / name).write_text(payload.get("text", ""), encoding="utf-8")
    return {"ok": True, "name": name, "size": (DATA / "notes" / name).stat().st_size}


@app.get("/api/calendar")
def calendar(month: str = ""):
    """The month view: what was done each day, what is left, what is due."""
    m = month or date.today().strftime("%Y-%m")
    try:
        y, mm = [int(x) for x in m.split("-")]
        first = date(y, mm, 1)
    except Exception:
        raise HTTPException(400, "the month must be YYYY-MM")
    nxt = date(y + (mm == 12), (mm % 12) + 1, 1)
    days_in = (nxt - first).days
    wl = _read("worklog.json", {"days": {}}).get("days", {})
    td = _read("todo.json", {"items": []}).get("items", [])
    out = []
    for i in range(days_in):
        day = (first + timedelta(days=i)).isoformat()
        rec = wl.get(day, {})
        due_today = [t for t in td if t.get("due") == day]
        out.append({"date": day, "summary": rec.get("summary", ""),
                    "work": rec.get("work", []),
                    "deadlines": rec.get("deadlines", []) + due_today})
    remaining = [t for t in td if t.get("status") not in ("done", "complete")]
    deadlines = sorted([t for t in td if t.get("due")],
                        key=lambda t: t.get("due"))
    return {"month": m, "days": out, "remaining": remaining,
            "deadlines": deadlines,
            "logged_days": sum(1 for d in out if d["work"] or d["summary"])}


@app.get("/api/secure")
def secure():
    """The INVENTORY. The values are never here - only where they live."""
    inv = _read("secrets.json", {"items": []}).get("items", [])
    out = []
    for it in inv:
        out.append({"service": it.get("service", ""),
                    "username": it.get("username", ""),
                    "value": "#######",
                    "location": it.get("location", ""),
                    "machine": it.get("machine", ""),
                    "rotated": it.get("rotated", ""),
                    "note": it.get("note", "")})
    return {"items": out,
            "details_file": SECRET_FILE.name,
            "details_file_exists": SECRET_FILE.exists(),
            "warning": "the values live in 1Password. " + SECRET_FILE.name +
                       " holds the pointers and is excluded from git."}


@app.get("/api/configs")
def configs():
    return _read("configs.json", {"groups": []})


@app.get("/api/network")
def network():
    return tailnet()


@app.get("/api/system")
def system():
    return system_stats()


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/bio")
def bio():
    """The profile: who, what, where - the one screen Hitchy opens."""
    reg = _read("projects.json", {"projects": []})
    prof = _read("profile.json", {})
    prof["project_count"] = len(reg.get("projects", []))
    prof["repos"] = [p.get("repo") for p in reg.get("projects", []) if p.get("repo")]
    return prof


app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
