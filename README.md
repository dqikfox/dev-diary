# DEV DIARY

Hitchy's personal project and work register for THRONE — one place that
knows every project, where it lives, how to start it, what was done on any
given day, what is still open, and what the machines are doing right now.

Local first. It binds to `127.0.0.1` and talks to nothing but this host
and the tailnet.

```
http://127.0.0.1:8530
```

---

## The menu

The first screen is a menu of seven:

| | | |
|---|---|---|
| **TODO** | everything open, blocked or overdue | `data/todo.json` |
| **DIARY** | the daily record and the working notes | `data/worklog.json`, `data/notes/` |
| **CALENDAR** | the work of each day, what remains, every deadline | `data/worklog.json` + `data/todo.json` |
| **PROJECTS** | every project, its links, its launcher, its machine | `data/projects.json` |
| **SECURE** | the credential inventory — values are always `#######` | `data/secrets.json` |
| **CONFIGS** | where each configuration lives and who owns it | `data/configs.json` |
| **NETWORK** | connected devices, and this machine's vitals | live |

---

## Running it

```cmd
C:\Users\KING\AppData\Local\hermes\scripts\start_devdiary.cmd
```

The launcher follows the house contract:

1. **Dependencies first.** Every tool is checked before the port is touched.
2. **The decision before the destruction.** `service_control.py prepare`
   probes the service, and it only reclaims the port when the port holds an
   orphan of ours. A healthy service is never torn down to be rebuilt, and a
   foreign holder is refused, not killed.
3. **No inherited stdout.** The server is spawned with explicit log files
   through `spawn_detached.py`, so it never holds a caller's pipe open.
4. **A fast wait.** The probe is a stdlib `urllib` call in the project's own
   interpreter.

Health: `http://127.0.0.1:8530/api/health`, and the body must carry the
marker `devdiary`. A 200 on any other path is not health.

The port is registered in `E:\ultron-memory\infra\PORT_MAP.json` and
`SERVICES.json`.

---

## The projects

Every entry carries what is needed to work it without remembering:

- the repository, the local path, and the machine it lives on
- the health URL, probed live — a port that answers is not the same as a
  service that answers with a body
- **the launcher**, with a button that runs it and waits for the service to
  come back. That is the "in case it is not running" path: one click.
- the links — the local address, the public address, the repo

A project that only exists on GitHub Pages is probed at its public address.
Probing a local port for a hosted site would report a healthy project as
down.

---

## The Secure view

The app shows the **inventory** — the service, the username, where the value
lives — and the value is always `#######`. The real contents are in
`secure details.md` beside the app, which is **excluded from git** and is
**never served over HTTP**.

The values themselves stay in 1Password. A pointer that says exactly which
item, in which vault, with which command is worth more than a plaintext
copy that has to be protected, rotated and purged — and it is the copy that
leaks.

---

## The calendar

A month view. Each day shows the work logged against it and the deadlines
falling on it. Below it, the work that remains and every dated item, with
anything overdue marked.

The daily record is written from the DIARY view: a one-line summary and the
work itself, one item per line, as `project — what was done`.

---

## The layout

```
dev diary/
  app.py                  the API
  dev_diary_server.py     the entry point the launcher spawns
  static/
    index.html            the shell and the first-open menu
    app.js                the client
    style.css             the surface
  data/
    projects.json         the project registry
    profile.json          the biography and the machine list
    todo.json             the open work
    worklog.json          the daily records
    notes/                the working notes
    configs.json          the configuration inventory
    secrets.json          the credential INVENTORY — no values
  secure details.md       the pointer document — gitignored, never served
  README.md
```

`dev_diary_server.py` is separate from `app.py` on purpose: the house
tooling identifies a service by the marker at the **end** of a command
line, and `app.py` is too generic to trust.
