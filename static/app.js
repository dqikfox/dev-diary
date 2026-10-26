/* DEV DIARY — the client.
   Vanilla, no framework, no build step. The estate is local, so the app is too. */

const S = {
  panel: "todo",
  data: {},
  month: "",
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts) {
  const r = await fetch(path, opts);
  const t = await r.text();
  try { return JSON.parse(t); } catch { throw new Error(t.slice(0, 200) || "bad response"); }
}
function toast(msg, kind) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show " + (kind || "");
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = "toast " + (kind || ""); }, 4200);
}
const mb = (b) => (b / 1048576).toFixed(1) + " MB";
const gb = (b) => (b / 1073741824).toFixed(1) + " GB";
// The LOCAL date, not the UTC one.
//
// toISOString() is UTC, and this host is UTC+11. At half past midnight
// local time the UTC date is still the PREVIOUS day, so every "today" in
// the app pointed at yesterday - and the calendar highlighted the wrong
// cell while the day's work sat in the next one.
const ldate = (d = new Date()) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
  String(d.getDate()).padStart(2, "0");
const when = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString("en-AU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

/* ------------------------------------------------------------------ clock */

function tick() {
  const n = new Date();
  const t = n.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
  $("#clock").textContent = t;
  $("#top-clock").textContent = t + " · THRONE";
  $("#today").textContent = n.toLocaleDateString("en-AU",
    { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
setInterval(tick, 1000); tick();

/* ------------------------------------------------------------------ menu */

const TITLES = {
  todo: ["TODO", "Everything still open, what is blocked, and what falls due next."],
  diary: ["DIARY", "The written record — daily reports, working notes, and what each day was."],
  calendar: ["CALENDAR", "The main work of each day, the work that remains, and every deadline."],
  projects: ["PROJECTS", "Every project with its links, its launcher, and the machine it lives on."],
  secure: ["SECURE", "The credential inventory. The values live in 1Password — here they are #######."],
  configs: ["CONFIGS", "Where every configuration lives, and which one owns it."],
  network: ["NETWORK", "The connected devices on the tailnet, and this machine's own vitals."],
};

function openMenu() {
  $("#menu").classList.remove("hidden");
  $("#shell").classList.add("hidden");
  if (location.hash) history.replaceState(null, "", location.pathname);
  loadCounts();
}
function enter(panel) {
  S.panel = panel;
  $("#menu").classList.add("hidden");
  $("#shell").classList.remove("hidden");
  $$(".rail-item").forEach(b => b.classList.toggle("active", b.dataset.panel === panel));
  $$(".panel").forEach(p => p.classList.add("hidden"));
  $("#panel-" + panel).classList.remove("hidden");
  const [t, s] = TITLES[panel];
  $("#panel-title").textContent = t;
  $("#panel-sub").textContent = s;
  // the hash makes a panel linkable - and it is what a screenshot or a
  // bookmark needs to land on the right screen
  history.replaceState(null, "", "#" + panel);
  render(panel);
}

async function loadCounts() {
  try {
    const [todo, cal, proj, sec, cfg, net, dia] = await Promise.all([
      api("/api/todo"), api("/api/calendar"), api("/api/projects"),
      api("/api/secure"), api("/api/configs"), api("/api/network"), api("/api/diary"),
    ]);
    const open = (todo.items || []).filter(i => i.status !== "done").length;
    $("#c-todo").textContent = open + " open of " + (todo.items || []).length;
    $("#c-diary").textContent = (dia.days || []).length + " days, " + (dia.notes || []).length + " notes";
    $("#c-calendar").textContent = (cal.logged_days || 0) + " days logged, " +
      (cal.remaining || []).length + " remaining";
    $("#c-projects").textContent = (proj.projects || []).length + " projects";
    const up = (proj.projects || []).filter(p => p.status && p.status.state === "up").length;
    $("#c-projects").textContent = (proj.projects || []).length + " projects · " + up + " live";
    $("#c-secure").textContent = (sec.items || []).length + " credentials";
    $("#c-configs").textContent = ((cfg.groups || []).length) + " groups";
    const on = (net.peers || []).filter(p => p.online).length;
    $("#c-network").textContent = on + " of " + (net.peers || []).length + " devices online";
    $("#menu-health").textContent = "estate reachable · " + new Date().toLocaleTimeString("en-AU");
  } catch (e) {
    $("#menu-health").textContent = "the estate did not answer: " + e.message;
  }
}

$$(".mcard").forEach(b => b.addEventListener("click", () => enter(b.dataset.panel)));
$$(".rail-item").forEach(b => b.addEventListener("click", () => enter(b.dataset.panel)));
$("#rail-menu").addEventListener("click", openMenu);

/* ------------------------------------------------------------------ render */

async function render(panel) {
  const el = $("#panel-" + panel);
  el.innerHTML = '<div class="empty">reading the estate…</div>';
  try {
    if (panel === "todo") return renderTodo(el);
    if (panel === "diary") return renderDiary(el);
    if (panel === "calendar") return renderCalendar(el);
    if (panel === "projects") return renderProjects(el);
    if (panel === "secure") return renderSecure(el);
    if (panel === "configs") return renderConfigs(el);
    if (panel === "network") return renderNetwork(el);
  } catch (e) {
    el.innerHTML = '<div class="empty">could not read it: ' + esc(e.message) + "</div>";
  }
}

/* ---------------- TODO ---------------- */

async function renderTodo(el) {
  const d = await api("/api/todo");
  S.data.todo = d;
  const items = d.items || [];
  const order = { active: 0, open: 1, blocked: 2, done: 3 };
  items.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) ||
    String(a.due || "9999").localeCompare(String(b.due || "9999")));
  const open = items.filter(i => i.status !== "done");
  const blocked = items.filter(i => i.status === "blocked");
  const overdue = items.filter(i => i.due && i.due < ldate() && i.status !== "done");

  el.innerHTML = `
    <div class="grid three" style="margin-bottom:16px">
      <div class="card"><h3>Open</h3><div class="big">${open.length}</div>
        <div class="sub">of ${items.length} tracked</div></div>
      <div class="card"><h3>Blocked</h3><div class="big" style="color:${blocked.length ? "var(--bad)" : "inherit"}">${blocked.length}</div>
        <div class="sub">waiting on something</div></div>
      <div class="card"><h3>Overdue</h3><div class="big" style="color:${overdue.length ? "var(--warn)" : "inherit"}">${overdue.length}</div>
        <div class="sub">past their date</div></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>New work</h3>
      <div class="form-row">
        <input class="field" id="nt-title" placeholder="What needs doing?" style="flex:2">
        <input class="field" id="nt-due" type="date" title="due date">
        <select class="field" id="nt-pri"><option value="normal">normal</option>
          <option value="high">high</option><option value="low">low</option></select>
        <button class="btn go" id="nt-add">add</button>
      </div>
    </div>
    <div class="card">
      <h3>The list</h3>
      <div id="todo-list">${items.length ? items.map(todoRow).join("") :
        '<div class="empty">Nothing tracked yet.</div>'}</div>
    </div>`;

  $("#nt-add").addEventListener("click", async () => {
    const title = $("#nt-title").value.trim();
    if (!title) return toast("Give it a title first.");
    await api("/api/todo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", title, due: $("#nt-due").value,
        priority: $("#nt-pri").value, project: $("#nt-proj") ? $("#nt-proj").value : "" }),
    });
    toast("Added: " + title, "ok"); renderTodo(el);
  });
  $$("[data-st]", el).forEach(s => s.addEventListener("click", async () => {
    const id = s.closest("[data-id]").dataset.id;
    const st = s.dataset.st;
    await api("/api/todo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", id, status: st }),
    });
    renderTodo(el);
  }));
  $$("[data-del]", el).forEach(s => s.addEventListener("click", async () => {
    const id = s.closest("[data-id]").dataset.id;
    await api("/api/todo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete", id }),
    });
    toast("Removed.", "ok"); renderTodo(el);
  }));
}

function todoRow(i) {
  const today = ldate();
  const late = i.due && i.due < today && i.status !== "done";
  const stTag = { open: "", active: "acc", blocked: "bad", done: "ok" }[i.status] || "";
  return `<div class="row" data-id="${esc(i.id)}">
    <span class="dot ${i.status === "done" ? "up" : i.status === "blocked" ? "down" : "none"}"></span>
    <div class="grow">
      <div class="t" style="${i.status === "done" ? "text-decoration:line-through;opacity:.5" : ""}">${esc(i.title)}</div>
      <div class="m">${esc(i.project || "no project")} · ${esc(i.priority || "normal")} priority${
        i.due ? ` · due ${esc(i.due)}` : ""}${late ? " · OVERDUE" : ""}</div>
    </div>
    <span class="tag ${stTag}">${esc(i.status)}</span>
    <div class="act">
      <button class="btn" data-st="active">work</button>
      <button class="btn" data-st="done">done</button>
      <button class="btn" data-st="blocked">block</button>
      <button class="btn" data-del="1">✕</button>
    </div>
  </div>`;
}

/* ---------------- DIARY ---------------- */

async function renderDiary(el) {
  const d = await api("/api/diary");
  const today = ldate();
  const days = d.days || [];
  const notes = d.notes || [];
  const cur = days.find(x => x.date === today) || days[0];

  el.innerHTML = `
    <div class="grid two">
      <div class="card">
        <h3>Daily record</h3>
        <div class="form-row" style="margin-bottom:10px">
          <input class="field" id="dy-date" type="date" value="${today}">
          <button class="btn" id="dy-load">load</button>
        </div>
        <input class="field" id="dy-sum" placeholder="One line about the day" style="margin-bottom:10px">
        <textarea class="field" id="dy-work" placeholder="The work itself, one item per line:
project — what was done"></textarea>
        <div class="form-row" style="margin-top:10px">
          <button class="btn go" id="dy-save">save the day</button>
          <span class="faint small" id="dy-saved"></span>
        </div>
      </div>
      <div class="card">
        <h3>Days</h3>
        <div id="dy-list">${days.length ? days.map(x => `
          <div class="row" data-day="${esc(x.date)}" style="cursor:pointer">
            <div class="grow">
              <div class="t">${esc(x.date)}${x.date === today ? " · today" : ""}</div>
              <div class="m">${esc(x.summary || "no summary")}</div>
            </div>
            <span class="tag">${x.count} item${x.count === 1 ? "" : "s"}</span>
          </div>`).join("") : '<div class="empty">No days recorded yet.</div>'}</div>
      </div>
      <div class="card">
        <h3>Notes</h3>
        <div class="form-row" style="margin-bottom:10px">
          <input class="field" id="nt-name" placeholder="note name (e.g. 2026-10-27-ideas.md)">
          <button class="btn go" id="nt-save">save</button>
        </div>
        <textarea class="field" id="nt-text" placeholder="the note"></textarea>
        <div id="note-list" style="margin-top:12px">${notes.length ? notes.map(n =>
          `<div class="row"><div class="grow"><div class="t">${esc(n.title)}</div>
           <div class="m">${esc(n.name)} · ${n.size} bytes</div></div>
           <button class="btn" data-note="${esc(n.name)}">open</button></div>`).join("") :
          '<div class="empty">No notes yet.</div>'}</div>
      </div>
    </div>`;

  const load = async (day) => {
    $("#dy-date").value = day;
    try {
      const rec = await api("/api/diary/day/" + day);
      $("#dy-sum").value = rec.summary || "";
      $("#dy-work").value = (rec.work || []).map(w =>
        (w.project ? w.project + " — " : "") + w.title + (w.status ? "  [" + w.status + "]" : "")).join("\n");
    } catch { $("#dy-sum").value = ""; $("#dy-work").value = ""; }
  };
  if (cur) load(cur.date);
  $("#dy-load").addEventListener("click", () => load($("#dy-date").value));
  $("#dy-save").addEventListener("click", async () => {
    const day = $("#dy-date").value;
    const work = $("#dy-work").value.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.match(/^([^—]+)—\s*(.*)$/);
      return m ? { project: m[1].trim(), title: m[2].trim(), status: "done" }
               : { title: l, status: "done" };
    });
    await api("/api/diary/day/" + day, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: $("#dy-sum").value, work }),
    });
    $("#dy-saved").textContent = "saved " + new Date().toLocaleTimeString("en-AU");
    toast("The day is recorded.", "ok"); renderDiary(el);
  });
  $("#nt-save").addEventListener("click", async () => {
    const n = $("#nt-name").value.trim();
    if (!n) return toast("Name the note first.");
    await api("/api/diary/note/" + n, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: $("#nt-text").value }),
    });
    toast("Note saved.", "ok"); renderDiary(el);
  });
  $$("[data-note]", el).forEach(b => b.addEventListener("click", async () => {
    const n = await api("/api/diary/note/" + b.dataset.note);
    $("#nt-name").value = n.name; $("#nt-text").value = n.text;
    toast("Opened " + n.name);
  }));
  $$("[data-day]", el).forEach(b => b.addEventListener("click", () => load(b.dataset.day)));
}

/* ---------------- CALENDAR ---------------- */

async function renderCalendar(el) {
  const m = S.month || new Date().toISOString().slice(0, 7);
  const d = await api("/api/calendar?month=" + m);
  S.month = d.month;
  const [y, mm] = d.month.split("-").map(Number);
  const first = new Date(y, mm - 1, 1);
  const lead = (first.getDay() + 6) % 7;  // Monday first
  const today = ldate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  cells.push(...d.days);
  while (cells.length % 7) cells.push(null);

  const dows = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const chip = (t, kind) => `<div class="cal-chip ${kind}" title="${esc(t.title || t)}">${esc(t.title || t)}</div>`;

  el.innerHTML = `
    <div class="cal-head">
      <h3 id="cal-label">${d.month}</h3>
      <button class="btn" id="cal-prev">◀</button>
      <button class="btn" id="cal-next">▶</button>
      <button class="btn" id="cal-today">this month</button>
      <span class="faint small" style="margin-left:auto">${d.logged_days} days logged ·
        ${d.remaining.length} still open · ${d.deadlines.length} with a date</span>
    </div>
    <div class="cal-grid" style="margin-bottom:22px">
      ${dows.map(x => `<div class="cal-dow">${x}</div>`).join("")}
      ${cells.map(c => {
        if (!c) return `<div class="cal-day other"></div>`;
        const chips = [];
        (c.work || []).slice(0, 3).forEach(w => chips.push(chip(w, w.status || "done")));
        (c.deadlines || []).slice(0, 2).forEach(w => chips.push(chip(w, "due")));
        const more = (c.work || []).length + (c.deadlines || []).length - chips.length;
        return `<div class="cal-day ${c.date === today ? "today" : ""}">
          <div class="d">${Number(c.date.slice(8))}</div>
          ${chips.join("")}
          ${more > 0 ? `<div class="cal-more">+${more} more</div>` : ""}
        </div>`;
      }).join("")}
    </div>
    <div class="grid two">
      <div class="card"><h3>Still to do</h3>
        ${d.remaining.length ? d.remaining.map(i => `
          <div class="row">
            <span class="dot ${i.status === "blocked" ? "down" : "none"}"></span>
            <div class="grow"><div class="t">${esc(i.title)}</div>
              <div class="m">${esc(i.project || "no project")}${i.due ? " · due " + esc(i.due) : ""}</div></div>
            <span class="tag ${i.status === "blocked" ? "bad" : i.status === "active" ? "acc" : ""}">${esc(i.status)}</span>
          </div>`).join("") : '<div class="empty">Nothing outstanding.</div>'}
      </div>
      <div class="card"><h3>Deadlines</h3>
        ${d.deadlines.length ? d.deadlines.map(i => `
          <div class="row">
            <div class="grow"><div class="t">${esc(i.title)}</div>
              <div class="m">${esc(i.due)} · ${esc(i.project || "no project")}</div></div>
            <span class="tag ${i.due < today && i.status !== "done" ? "bad" : "warn"}">${esc(i.due)}</span>
          </div>`).join("") : '<div class="empty">No dates set.</div>'}
      </div>
    </div>`;

  const shift = (n) => {
    const [yy, mm2] = m.split("-").map(Number);
    const nd = new Date(yy, mm2 - 1 + n, 1);
    S.month = nd.toISOString().slice(0, 7);
    renderCalendar(el);
  };
  $("#cal-prev").addEventListener("click", () => shift(-1));
  $("#cal-next").addEventListener("click", () => shift(1));
  $("#cal-today").addEventListener("click", () => { S.month = ""; renderCalendar(el); });
}

/* ---------------- PROJECTS ---------------- */

async function renderProjects(el) {
  const d = await api("/api/projects");
  const ps = d.projects || [];
  const groups = {};
  ps.forEach(p => { (groups[p.category || "other"] = groups[p.category || "other"] || []).push(p); });

  el.innerHTML = `
    <div class="grid three" style="margin-bottom:18px">
      <div class="card"><h3>Projects</h3><div class="big">${ps.length}</div>
        <div class="sub">under the estate</div></div>
      <div class="card"><h3>Live now</h3><div class="big" style="color:var(--ok)">${
        ps.filter(p => p.status && p.status.state === "up").length}</div>
        <div class="sub">answering a health probe</div></div>
      <div class="card"><h3>Machines</h3><div class="big">${
        new Set(ps.flatMap(p => p.machines || [])).size}</div>
        <div class="sub">hosts in play</div></div>
    </div>
    ${Object.keys(groups).map(cat => `
      <div class="card" style="margin-bottom:14px">
        <h3>${esc(cat)}</h3>
        ${groups[cat].map(projectCard).join("")}
      </div>`).join("")}`;

  $$("[data-launch]", el).forEach(b => b.addEventListener("click", async () => {
    const id = b.dataset.launch;
    b.disabled = true; b.textContent = "starting…";
    const r = await api("/api/projects/" + id + "/launch", { method: "POST" });
    toast(r.detail || (r.ok ? "started" : "failed"), r.up === false ? "bad" : "ok");
    b.disabled = false; b.textContent = "launch";
    renderProjects(el);
  }));
}

function projectCard(p) {
  const st = p.status || { state: "none" };
  const links = (p.links || []).map(l =>
    `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("");
  const mach = (p.machines || []).map(m => `<span class="machine">${esc(m)}</span>`).join(" ");
  return `<div class="row" style="align-items:flex-start">
    <span class="dot ${esc(st.state)}" style="margin-top:6px"></span>
    <div class="grow">
      <div class="t"><b>${esc(p.name)}</b> ${mach}</div>
      <div class="m">${esc(p.role || "")}</div>
      <div class="m" style="margin-top:5px">
        ${st.state === "up" ? `live · ${st.ms} ms` :
          st.state === "none" ? "not a running service" :
          `${st.state} · ${esc(st.detail || "")}`}
        ${p.service && p.service.port ? " · port " + p.service.port : ""}
      </div>
      ${p.path ? `<div class="m">${esc(p.path)}${p.path_exists ? "" : " — missing"}</div>` : ""}
      ${links ? `<div class="links">${links}</div>` : ""}
    </div>
    <div class="act" style="flex-direction:column;align-items:flex-end;gap:6px">
      ${p.launcher ? `<button class="btn go" data-launch="${esc(p.id)}"
        ${p.launcher_exists ? "" : "disabled"}>${p.launcher_exists ? "launch" : "no launcher"}</button>` : ""}
      ${p.repo ? `<a class="btn" href="${esc(p.repo)}" target="_blank" rel="noopener">repo</a>` : ""}
    </div>
  </div>`;
}

/* ---------------- SECURE ---------------- */

async function renderSecure(el) {
  const d = await api("/api/secure");
  const items = d.items || [];
  el.innerHTML = `
    <div class="card" style="margin-bottom:16px;border-color:rgba(232,196,104,.28)">
      <h3 style="color:var(--gold)">How the values are held</h3>
      <p class="small muted" style="margin:0 0 10px;line-height:1.65">
        ${esc(d.warning)} The inventory below names every credential the estate uses and
        where the real value lives. The value column is
        <span class="mono" style="color:var(--gold)">#######</span> everywhere — by design,
        so this page can be shown, screenshotted or published without leaking anything.
      </p>
      <div class="m faint">the details file: <b>${esc(d.details_file)}</b>
        ${d.details_file_exists ? "— present on disk" : "— not written yet"}</div>
    </div>
    <div class="card">
      <h3>The inventory — ${items.length} credentials</h3>
      ${items.length ? items.map(i => `
        <div class="row">
          <div class="grow">
            <div class="t"><b>${esc(i.service)}</b>
              ${i.username ? `<span class="faint">· ${esc(i.username)}</span>` : ""}
              ${i.machine ? `<span class="machine">${esc(i.machine)}</span>` : ""}</div>
            <div class="m">${esc(i.location)}${i.rotated ? " · rotated " + esc(i.rotated) : ""}</div>
            ${i.note ? `<div class="m" style="color:var(--fg-dim)">${esc(i.note)}</div>` : ""}
          </div>
          <div class="act"><span class="mono" style="color:var(--gold);letter-spacing:1px">#######</span></div>
        </div>`).join("") : '<div class="empty">No credentials recorded.</div>'}
    </div>`;
}

/* ---------------- CONFIGS ---------------- */

async function renderConfigs(el) {
  const d = await api("/api/configs");
  const gs = d.groups || [];
  el.innerHTML = gs.map(g => `
    <div class="card" style="margin-bottom:14px">
      <h3>${esc(g.group)}${g.owner ? " — " + esc(g.owner) : ""}</h3>
      ${(g.items || []).map(i => `
        <div class="row">
          <div class="grow">
            <div class="t">${esc(i.name)}</div>
            <div class="m">${esc(i.path || i.url || "")}</div>
            ${i.note ? `<div class="m" style="color:var(--fg-dim)">${esc(i.note)}</div>` : ""}
          </div>
          ${i.machine ? `<span class="machine">${esc(i.machine)}</span>` : ""}
        </div>`).join("")}
    </div>`).join("") || '<div class="empty">No configuration registry yet.</div>';
}

/* ---------------- NETWORK ---------------- */

async function renderNetwork(el) {
  const [net, sys] = await Promise.all([api("/api/network"), api("/api/system")]);
  const peers = net.peers || [];
  const cpu = sys.cpu || {}, ram = sys.ram || {}, gpu = sys.gpu;

  el.innerHTML = `
    <div class="grid three" style="margin-bottom:18px">
      <div class="card"><h3>CPU</h3>
        <div class="big">${cpu.percent != null ? cpu.percent + "%" : "—"}</div>
        <div class="sub">${cpu.physical || "?"} physical · ${cpu.cores || "?"} logical</div>
        <div class="bar ${cpu.percent > 85 ? "bad" : cpu.percent > 60 ? "warn" : ""}">
          <i style="width:${Math.min(100, cpu.percent || 0)}%"></i></div>
      </div>
      <div class="card"><h3>Memory</h3>
        <div class="big">${ram.percent != null ? ram.percent + "%" : "—"}</div>
        <div class="sub">${ram.used ? gb(ram.used) + " of " + gb(ram.total) : ""}</div>
        <div class="bar ${ram.percent > 88 ? "bad" : ram.percent > 70 ? "warn" : ""}">
          <i style="width:${Math.min(100, ram.percent || 0)}%"></i></div>
      </div>
      <div class="card"><h3>GPU</h3>
        <div class="big">${gpu && gpu.name ? gpu.util_percent + "%" : "—"}</div>
        <div class="sub">${gpu && gpu.name ? gpu.name : "no NVIDIA adapter reported"}</div>
        ${gpu && gpu.vram_total_mb ? `<div class="sub">${gpu.vram_used_mb} / ${gpu.vram_total_mb} MB VRAM · ${gpu.temp_c}°C</div>` : ""}
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <h3>This machine</h3>
      <div class="row"><div class="grow"><div class="t">${esc(sys.host)}</div>
        <div class="m">${esc(net.self && net.self.ip || "")} · up ${esc(sys.uptime_human || "")}
         · ${sys.processes} processes</div></div>
        <span class="tag ok">SOVEREIGN SEAT</span></div>
    </div>

    <div class="card">
      <h3>Connected devices — ${peers.length} on the tailnet</h3>
      ${peers.map(p => `
        <div class="row">
          <span class="dot ${p.online ? "up" : "down"}"></span>
          <div class="grow">
            <div class="t">${esc(p.name)} <span class="faint small">${esc(p.os)}</span></div>
            <div class="m">${esc(p.ip)}${p.last_seen && !p.online ? " · last seen " + when(p.last_seen) : ""}</div>
          </div>
          <span class="tag ${p.online ? "ok" : ""}">${p.online ? "online" : "offline"}</span>
        </div>`).join("") || '<div class="empty">No peers reported.</div>'}
    </div>

    <div class="card" style="margin-top:14px">
      <h3>Storage</h3>
      ${(sys.disks || []).map(d => `
        <div class="row">
          <div class="grow">
            <div class="t">${esc(d.drive)}</div>
            <div class="m">${gb(d.used)} used of ${gb(d.total)} · ${gb(d.free)} free</div>
            <div class="bar ${d.percent > 88 ? "bad" : d.percent > 75 ? "warn" : ""}">
              <i style="width:${Math.min(100, d.percent)}%"></i></div>
          </div>
          <span class="mono small">${d.percent}%</span>
        </div>`).join("")}
    </div>`;
}


/* ------------------------------------------------------------------ vitals */

async function refreshVitals() {
  try {
    const s = await api("/api/system");
    $("#rail-up").textContent = "up " + (s.uptime_human || "—");
    S.sys = s;
  } catch { /* the rail keeps its last reading */ }
}

/* ------------------------------------------------------------------ boot */

(async function boot() {
  try {
    const h = await api("/api/health");
    $("#top-health").textContent = "health " + h.status;
    $("#top-health").className = "pill ok";
  } catch {
    $("#top-health").textContent = "health offline";
    $("#top-health").className = "pill bad";
  }
  loadCounts();
  setInterval(loadCounts, 60000);
  refreshVitals();
  // a hash opens that panel directly, so a link can point at one screen
  const h = (location.hash || "").replace("#", "");
  if (h && TITLES[h]) enter(h);
})();
