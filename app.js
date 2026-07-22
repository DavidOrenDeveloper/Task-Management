// app.js — ניווט, רינדור, וטיפול באירועים
const APP_VERSION = "2.0.2";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => (s || "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  view: "tasks",
  taskStatusFilter: "all",
  taskTypeFilter: "all",
  orderStatusFilter: "all",
  questionStatusFilter: "all",
  tasksSort: Store.data.uiPrefs.tasksSort,
  ordersSort: Store.data.uiPrefs.ordersSort,
  questionsSort: Store.data.uiPrefs.questionsSort,
  buildingsSort: Store.data.uiPrefs.buildingsSort,
};

// ---------------- Toast ----------------
let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

// ==========================================================
// Custom dialog system — replaces native alert()/confirm()/prompt()
// ==========================================================
let dialogResolve = null;
function closeDialog(result) {
  $("#dialog-backdrop").classList.remove("show");
  $("#dialog-box").classList.remove("show");
  if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(result); }
}
$("#dialog-backdrop").addEventListener("click", () => closeDialog(null));

function showDialog({ title, message = "", inputsHTML = "", buttons }) {
  return new Promise((resolve) => {
    dialogResolve = resolve;
    const box = $("#dialog-box");
    box.innerHTML = `
      ${title ? `<h3>${esc(title)}</h3>` : ""}
      ${message ? `<p>${esc(message)}</p>` : ""}
      ${inputsHTML}
      <div class="dialog-actions">
        ${buttons.map((b, i) => `<button class="dialog-btn ${b.style || ""}" data-i="${i}">${esc(b.label)}</button>`).join("")}
      </div>
    `;
    $$(".dialog-btn", box).forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = buttons[parseInt(btn.dataset.i)];
        const values = {};
        $$("[data-field]", box).forEach((f) => { values[f.dataset.field] = f.value; });
        closeDialog({ value: b.value, values });
      });
    });
    $("#dialog-backdrop").classList.add("show");
    box.classList.add("show");
    const firstInput = $("input,textarea", box);
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  });
}

async function alertDialog(title, message) {
  await showDialog({ title, message, buttons: [{ label: "אישור", value: true, style: "primary" }] });
}
async function confirmDialog(title, message, confirmLabel = "אישור", danger = true) {
  const r = await showDialog({
    title, message,
    buttons: [
      { label: "ביטול", value: false, style: "ghost" },
      { label: confirmLabel, value: true, style: danger ? "danger" : "primary" },
    ],
  });
  return !!(r && r.value);
}
async function promptDialog(title, label, defaultValue = "", placeholder = "") {
  const r = await showDialog({
    title,
    inputsHTML: `<div class="field"><label>${esc(label)}</label><input type="text" data-field="v" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}"></div>`,
    buttons: [
      { label: "ביטול", value: false, style: "ghost" },
      { label: "אישור", value: true, style: "primary" },
    ],
  });
  if (!r || !r.value) return null;
  return r.values.v.trim();
}
// choose between multiple named actions, e.g. deleting a category
async function chooseDialog(title, message, options) {
  const r = await showDialog({
    title, message,
    buttons: options,
  });
  return r ? r.value : null;
}

// ---------------- Sheet (bottom modal) ----------------
function openSheet(html) {
  $("#sheet-content").innerHTML = html;
  $("#sheet").classList.add("show");
  $("#sheet-backdrop").classList.add("show");
}
function closeSheet() {
  $("#sheet").classList.remove("show");
  $("#sheet-backdrop").classList.remove("show");
}
$("#sheet-backdrop").addEventListener("click", closeSheet);

// ==========================================================
// Sort menu (small popover)
// ==========================================================
function openSortMenu(anchorEl, currentValue, options, onSelect) {
  const menu = $("#sort-menu");
  menu.innerHTML = options.map((o) => `<div class="opt ${o.value === currentValue ? "active" : ""}" data-val="${o.value}">${esc(o.label)} ${o.value === currentValue ? "✓" : ""}</div>`).join("");
  const rect = anchorEl.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 6}px`;
  const isRTLNearRight = rect.right;
  menu.style.left = "auto";
  menu.style.right = `${Math.max(10, window.innerWidth - rect.right)}px`;
  $$(".opt", menu).forEach((opt) => opt.addEventListener("click", () => {
    onSelect(opt.dataset.val);
    closeSortMenu();
  }));
  menu.classList.add("show");
  $("#sort-menu-backdrop").classList.add("show");
}
function closeSortMenu() {
  $("#sort-menu").classList.remove("show");
  $("#sort-menu-backdrop").classList.remove("show");
}
$("#sort-menu-backdrop").addEventListener("click", closeSortMenu);

// ==========================================================
// Long-press drag reorder — works on any list of sibling items
// ==========================================================
function enableLongPressReorder(container, itemSelector, onReorder) {
  let pressTimer = null;
  let dragEl = null;
  let startX = 0, startY = 0;
  let moved = false;
  let dragEndedAt = 0;

  function getItems() { return $$(itemSelector, container); }

  function cancelPress() { clearTimeout(pressTimer); pressTimer = null; }

  function startDrag(el) {
    dragEl = el;
    dragEl.classList.add("dragging");
    container.classList.add("reorder-active");
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }

  function finishDrag() {
    dragEl.classList.remove("dragging");
    container.classList.remove("reorder-active");
    const ids = getItems().map((el) => el.dataset.id || el.dataset.reorderId);
    dragEl = null;
    dragEndedAt = Date.now();
    onReorder(ids);
  }

  // Attached once: blocks the single tap-release click that immediately follows a drag,
  // without risking a permanently-stuck listener if the browser happens not to fire that click.
  container.addEventListener("click", (e) => {
    if (Date.now() - dragEndedAt < 400) { e.stopPropagation(); e.preventDefault(); }
  }, true);

  container.addEventListener("pointerdown", (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    if (e.target.closest("button, input, textarea, select, a, .status-dot")) return;
    moved = false;
    startX = e.clientX; startY = e.clientY;
    cancelPress();
    pressTimer = setTimeout(() => { if (!moved) startDrag(item); }, 420);
  });

  container.addEventListener("pointermove", (e) => {
    if (!dragEl) {
      if (Math.abs(e.clientX - startX) > 9 || Math.abs(e.clientY - startY) > 9) { moved = true; cancelPress(); }
      return;
    }
    e.preventDefault();
    const items = getItems().filter((el) => el !== dragEl);
    let closest = null, closestOffset = Number.NEGATIVE_INFINITY;
    items.forEach((el) => {
      const box = el.getBoundingClientRect();
      const offset = e.clientY - (box.top + box.height / 2);
      if (offset < 0 && offset > closestOffset) { closestOffset = offset; closest = el; }
    });
    if (closest) container.insertBefore(dragEl, closest);
    else container.appendChild(dragEl);
  }, { passive: false });

  function onUp() { cancelPress(); if (dragEl) finishDrag(); moved = false; }
  container.addEventListener("pointerup", onUp);
  container.addEventListener("pointercancel", onUp);
}

// ---------------- Navigation ----------------
function switchView(name) {
  state.view = name;
  $$(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${name}`).classList.add("active");
  $$(".bottomnav button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  renderAll();
}
$$(".bottomnav button").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));

// ---------------- Helpers: buildings/floors lookup ----------------
function buildingName(id) {
  const b = Store.data.buildings.find((x) => x.id === id);
  return b ? b.name : null;
}
function floorName(buildingId, floorId) {
  const b = Store.data.buildings.find((x) => x.id === buildingId);
  if (!b) return null;
  const f = b.floors.find((x) => x.id === floorId);
  return f ? f.name : null;
}
function locationLabel(item) {
  const bn = buildingName(item.buildingId);
  if (!bn) return null;
  const fn = floorName(item.buildingId, item.floorId);
  return fn ? `${bn} · ${fn}` : bn;
}
function buildingBudgetFor(item) {
  const b = Store.data.buildings.find((x) => x.id === item.buildingId);
  if (!b) return null;
  const f = b.floors.find((x) => x.id === item.floorId);
  return (f && f.budgetCode) || b.budgetCode || null;
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "עכשיו";
  if (min < 60) return `לפני ${min} דק'`;
  const h = Math.floor(min / 60);
  if (h < 24) return `לפני ${h} שע'`;
  const d = Math.floor(h / 24);
  return `לפני ${d} ימים`;
}

function toDatetimeLocalValue(ts) {
  if (!ts) return "";
  const d = new Date(ts - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function formatDueLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `היום ${time}`;
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `מחר ${time}`;
  return `${d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" })} ${time}`;
}
function taskUrgency(t) {
  if (!t.dueAt || t.status === "done" || t.hold) return null;
  const now = Date.now();
  if (t.dueAt <= now) return "overdue";
  if (t.dueAt - now <= 60 * 60000) return "soon";
  return "later";
}

// ---------------- Building/Floor <select> builder ----------------
function buildingSelectHTML(selectedBuildingId, selectedFloorId) {
  const buildings = Store.data.buildings;
  let html = `<div class="field-row">
    <div class="field">
      <label>בניין (אופציונלי)</label>
      <select id="f-building">
        <option value="">— ללא —</option>
        ${buildings.map((b) => `<option value="${b.id}" ${b.id === selectedBuildingId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
      </select>
    </div>
    <div class="field">
      <label>קומה</label>
      <select id="f-floor">
        <option value="">— ללא —</option>
      </select>
    </div>
  </div>`;
  return html;
}
function wireFloorSelect(selectedBuildingId, selectedFloorId) {
  const bSel = $("#f-building");
  const fSel = $("#f-floor");
  function fillFloors(bid, chosen) {
    const b = Store.data.buildings.find((x) => x.id === bid);
    fSel.innerHTML = `<option value="">— ללא —</option>` + (b ? b.floors.map((f) => `<option value="${f.id}" ${f.id === chosen ? "selected" : ""}>${esc(f.name)}</option>`).join("") : "");
  }
  fillFloors(selectedBuildingId, selectedFloorId);
  bSel.addEventListener("change", () => fillFloors(bSel.value, null));
}

function budgetFieldHTML(value) {
  return `<div class="field">
    <label>סעיף תקציבי (אופציונלי)</label>
    <input type="text" id="f-budget" value="${esc(value || "")}" placeholder="לדוגמה: 4021-חשמל">
  </div>`;
}

// ==========================================================
// Generic category chip group (used inside task/order forms)
// Lets the user add/remove categories without leaving the form.
// ==========================================================
function categoryChipGroupHTML(groupId, items, selected, manage) {
  return `
    <div class="select-chip-group ${manage ? "manage" : ""}" id="${groupId}">
      ${items.map((c) => `<div class="select-chip ${c === selected ? "active" : ""}" data-val="${esc(c)}">
        ${esc(c)}${manage ? `<span class="chip-x" data-del="${esc(c)}">✕</span>` : ""}
      </div>`).join("")}
      ${manage ? `<div class="select-chip add-new" data-add="1">+ קטגוריה חדשה</div>` : ""}
    </div>
    <button type="button" class="cat-manage-toggle" data-toggle-manage="${groupId}">${manage ? "סיום ניהול קטגוריות" : "➕ הוספה / הסרה של קטגוריות"}</button>
  `;
}

// wraps a chip group + manage-toggle. Returns an object exposing the currently selected value.
function wireCategoryChipGroup(wrapEl, groupId, opts) {
  // opts: { getItems, getUsage, addFn, deleteFn, getSelected, onSelect, title }
  let manage = false;

  function render() {
    wrapEl.innerHTML = categoryChipGroupHTML(groupId, opts.getItems(), opts.getSelected(), manage);
    wire();
  }

  function wire() {
    const group = $(`#${groupId}`, wrapEl);
    group.addEventListener("click", async (e) => {
      const delBtn = e.target.closest("[data-del]");
      const addBtn = e.target.closest("[data-add]");
      const chip = e.target.closest(".select-chip");
      if (delBtn) {
        e.stopPropagation();
        const name = delBtn.dataset.del;
        const usage = opts.getUsage(name);
        if (usage.length > 0) {
          const choice = await chooseDialog(
            `מחיקת הקטגוריה "${name}"`,
            `יש ${usage.length} פריטים תחת הקטגוריה הזו. מה לעשות איתם?`,
            [
              { label: "ביטול", value: "cancel", style: "ghost" },
              { label: `העברה ל"${GENERAL_CATEGORY}"`, value: "reassign", style: "primary" },
              { label: "מחיקת כל הפריטים", value: "delete", style: "danger" },
            ]
          );
          if (!choice || choice === "cancel") return;
          opts.deleteFn(name, choice);
          toast(choice === "delete" ? "הקטגוריה והפריטים נמחקו" : "הקטגוריה נמחקה, הפריטים הועברו ל" + GENERAL_CATEGORY);
        } else {
          const ok = await confirmDialog("מחיקת קטגוריה", `למחוק את "${name}"? אין פריטים תחת קטגוריה זו.`, "מחיקה");
          if (!ok) return;
          opts.deleteFn(name, "reassign");
          toast("נמחק");
        }
        if (opts.getSelected() === name) opts.onSelect(opts.getItems()[0] || "");
        render();
        renderAllListsQuiet();
        return;
      }
      if (addBtn) {
        e.stopPropagation();
        const name = await promptDialog("קטגוריה חדשה", "שם הקטגוריה", "", "לדוגמה: תשתיות");
        if (!name) return;
        opts.addFn(name);
        opts.onSelect(name);
        render();
        return;
      }
      if (chip) {
        if (manage) return; // in manage mode taps only toggle via x / add
        opts.onSelect(chip.dataset.val);
        $$(".select-chip", group).forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
      }
    });
    $(`[data-toggle-manage="${groupId}"]`, wrapEl).addEventListener("click", () => {
      manage = !manage;
      render();
    });
  }

  render();
}
// re-render the currently visible list views after a category rename/delete from within a form
function renderAllListsQuiet() {
  renderTasks(); renderOrders();
}

// ==========================================================
// TASKS
// ==========================================================
const TASKS_SORT_OPTIONS = [
  { value: "default", label: "ברירת מחדל (סטטוס)" },
  { value: "created", label: "תאריך יצירה" },
  { value: "updated", label: "עודכן לאחרונה" },
  { value: "alpha", label: "לפי א-ב" },
  { value: "priority", label: "דחיפות" },
  { value: "due", label: "מועד תזכורת" },
  { value: "manual", label: "סדר ידני (גרירה)" },
];

function sortItems(items, mode, kind) {
  const arr = [...items];
  if (mode === "manual") { arr.sort((a, b) => a.order - b.order); return arr; }
  if (mode === "created") { arr.sort((a, b) => b.createdAt - a.createdAt); return arr; }
  if (mode === "updated") { arr.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)); return arr; }
  if (mode === "alpha") { arr.sort((a, b) => (a.title || a.text || "").localeCompare(b.title || b.text || "", "he")); return arr; }
  if (mode === "priority" && kind === "task") { arr.sort((a, b) => (b.priority === "high") - (a.priority === "high")); return arr; }
  if (mode === "due" && kind === "task") {
    arr.sort((a, b) => {
      const av = a.dueAt || Infinity, bv = b.dueAt || Infinity;
      return av - bv;
    });
    return arr;
  }
  if (mode === "category" && kind === "order") { arr.sort((a, b) => (a.category || "").localeCompare(b.category || "", "he")); return arr; }
  if (mode === "status" && kind === "order") {
    const idx = { pending: 0, ordered: 1, arrived: 2, installed: 3 };
    arr.sort((a, b) => idx[a.status] - idx[b.status]);
    return arr;
  }
  return arr;
}

function renderTaskTypeFilterChips() {
  const wrap = $("#tasks-type-filter");
  const types = Store.data.taskTypes;
  wrap.innerHTML = `<div class="chip ${state.taskTypeFilter === "all" ? "active" : ""}" data-type="all">כל הסוגים</div>` +
    types.map((t) => `<div class="chip ${state.taskTypeFilter === t ? "active" : ""}" data-type="${esc(t)}">${esc(t)}</div>`).join("");
  $$("#tasks-type-filter .chip").forEach((c) => c.addEventListener("click", () => {
    state.taskTypeFilter = c.dataset.type;
    renderTasks();
  }));
}

function renderTasks() {
  renderTaskTypeFilterChips();
  const list = $("#tasks-list");
  let items = [...Store.data.tasks];
  if (state.taskStatusFilter === "hold") items = items.filter((t) => t.hold);
  else if (state.taskStatusFilter !== "all") items = items.filter((t) => t.status === state.taskStatusFilter);
  if (state.taskTypeFilter !== "all") items = items.filter((t) => t.type === state.taskTypeFilter);

  if (state.tasksSort === "default") {
    items.sort((a, b) => {
      const order = { open: 0, in_progress: 1, done: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return b.updatedAt - a.updatedAt;
    });
  } else {
    items = sortItems(items, state.tasksSort, "task");
  }

  $("#tasks-count").textContent = `${items.length} פריטים`;

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">✅</div><p>אין משימות להצגה.<br>לחץ על + כדי להוסיף משימה חדשה.</p></div>`;
    return;
  }

  list.innerHTML = items.map((t) => {
    const loc = locationLabel(t);
    const budget = buildingBudgetFor(t) || t.budgetCode;
    const urgency = taskUrgency(t);
    return `
    <div class="card ${t.status === "done" ? "done" : ""} ${urgency ? "urgency-" + urgency : ""}" data-id="${t.id}" data-reorder-item>
      <div class="card-top">
        <span class="drag-handle">⠿</span>
        <div class="status-dot ${t.status}" data-action="cycle-status"></div>
        <div class="card-title ${t.status === "done" ? "strike" : ""}">${esc(t.title)}</div>
      </div>
      <div class="card-meta">
        <span class="tag type">${esc(t.type)}</span>
        ${loc ? `<span class="tag loc">📍 ${esc(loc)}</span>` : ""}
        ${t.priority === "high" ? `<span class="tag prio-high">דחוף</span>` : ""}
        ${t.hold ? `<span class="tag hold">⏸ בהמתנה</span>` : ""}
        ${t.dueAt && !t.hold && t.status !== "done" ? `<span class="tag due ${urgency === "overdue" ? "due-overdue" : urgency === "soon" ? "due-soon" : "due-later"}">⏰ ${esc(formatDueLabel(t.dueAt))}</span>` : ""}
      </div>
      ${t.notes.length ? `<div class="card-notes">${t.notes.map((n) => `<div class="note-line"><span>${esc(n.text)}</span><button class="note-del" data-note="${n.id}">✕</button></div>`).join("")}</div>` : ""}
      ${t.budgetCode || budget ? `<button class="budget-toggle" data-action="toggle-budget">💰 סעיף תקציבי</button><div class="budget-value">קוד: <b>${esc(t.budgetCode || budget)}</b></div>` : ""}
      <div class="card-actions">
        <button data-action="add-note">📝 הוסף הערה</button>
        <button data-action="edit">✏️ ערוך</button>
        <button data-action="delete" class="danger">🗑 מחק</button>
      </div>
      ${t.dueAt && t.status !== "done" ? `
      <div class="reminder-row-actions" style="margin-top:10px">
        <button data-action="complete">✓ הושלם</button>
        <button data-action="snooze">⏰ נודניק</button>
        <button data-action="toggle-hold" class="${t.hold ? "on" : ""}">${t.hold ? "▶ הפעל שוב" : "⏸ המתנה"}</button>
      </div>` : ""}
      <div style="font-size:11px;color:var(--text-dim);margin-top:8px">עודכן ${timeAgo(t.updatedAt)}</div>
    </div>`;
  }).join("");
}

$$("#tasks-status-filter .chip").forEach((c) => c.addEventListener("click", () => {
  $$("#tasks-status-filter .chip").forEach((x) => x.classList.remove("active"));
  c.classList.add("active");
  state.taskStatusFilter = c.dataset.status;
  renderTasks();
}));
$("#tasks-sort-btn").addEventListener("click", (e) => {
  openSortMenu(e.currentTarget, state.tasksSort, TASKS_SORT_OPTIONS, (val) => {
    state.tasksSort = val; Store.setUiPref("tasksSort", val); renderTasks();
  });
});
enableLongPressReorder($("#tasks-list"), "[data-reorder-item]", (ids) => {
  Store.reorderTasks(ids);
  if (state.tasksSort !== "manual") { state.tasksSort = "manual"; Store.setUiPref("tasksSort", "manual"); }
  renderTasks();
});
wireCardActions($("#tasks-list"), "task");

function reminderSectionHTML(task) {
  const dueVal = task && task.dueAt ? toDatetimeLocalValue(task.dueAt) : "";
  const repeatVal = (task && task.reminder && task.reminder.repeatMinutes) || "";
  return `
    <div class="reminder-section">
      <div class="field">
        <label>תזכורת (אופציונלי) — כמו תזכיר בטלפון</label>
        <input type="datetime-local" id="f-due" value="${dueVal}">
      </div>
      <div class="field">
        <label>התראה חוזרת (נודניק אוטומטי)</label>
        <select id="f-repeat">
          <option value="" ${!repeatVal ? "selected" : ""}>ללא חזרה</option>
          <option value="15" ${repeatVal == 15 ? "selected" : ""}>כל 15 דקות</option>
          <option value="30" ${repeatVal == 30 ? "selected" : ""}>כל חצי שעה</option>
          <option value="60" ${repeatVal == 60 ? "selected" : ""}>כל שעה</option>
          <option value="120" ${repeatVal == 120 ? "selected" : ""}>כל שעתיים</option>
          <option value="1440" ${repeatVal == 1440 ? "selected" : ""}>כל יום</option>
        </select>
      </div>
    </div>
  `;
}

function taskFormHTML(task) {
  const isEdit = !!task;
  task = task || { title: "", type: Store.data.taskTypes[0] || "", priority: "normal", buildingId: "", floorId: "", budgetCode: "" };
  return `
    <h3>${isEdit ? "עריכת משימה" : "משימה חדשה"}</h3>
    <div class="field">
      <label>תיאור המשימה</label>
      <input type="text" id="f-title" value="${esc(task.title)}" placeholder="לדוגמה: להתקין לוח חשמל בקומה 3" autofocus>
    </div>
    <div class="field">
      <label>סוג</label>
      <div id="f-type-wrap"></div>
    </div>
    ${buildingSelectHTML(task.buildingId, task.floorId)}
    <div class="field">
      <label>עדיפות</label>
      <div class="select-chip-group" id="f-priority-group">
        <div class="select-chip ${task.priority !== "high" ? "active" : ""}" data-val="normal">רגילה</div>
        <div class="select-chip ${task.priority === "high" ? "active" : ""}" data-val="high">דחופה</div>
      </div>
    </div>
    ${budgetFieldHTML(task.budgetCode)}
    ${reminderSectionHTML(isEdit ? task : null)}
    <button class="btn-primary" id="save-task">${isEdit ? "שמירה" : "הוספת משימה"}</button>
    ${isEdit ? `<button class="btn-danger" id="delete-task">מחיקת משימה</button>` : ""}
  `;
}

function openTaskForm(taskId, presetLocation) {
  const task = taskId ? Store.data.tasks.find((t) => t.id === taskId) : null;
  openSheet(taskFormHTML(task));
  wireFloorSelect(task ? task.buildingId : (presetLocation && presetLocation.buildingId), task ? task.floorId : (presetLocation && presetLocation.floorId));
  if (presetLocation && !task) {
    $("#f-building").value = presetLocation.buildingId || "";
    wireFloorSelect(presetLocation.buildingId, presetLocation.floorId);
    setTimeout(() => { if ($("#f-floor")) $("#f-floor").value = presetLocation.floorId || ""; }, 0);
  }
  let selType = task ? task.type : Store.data.taskTypes[0];
  let selPriority = task ? task.priority : "normal";
  wireCategoryChipGroup($("#f-type-wrap"), "f-type-group", {
    getItems: () => Store.data.taskTypes,
    getUsage: (name) => Store.usageOfTaskType(name),
    addFn: (name) => Store.addTaskType(name),
    deleteFn: (name, mode) => Store.deleteTaskType(name, mode),
    getSelected: () => selType,
    onSelect: (val) => { selType = val; },
  });
  $("#f-priority-group").addEventListener("click", (e) => {
    if (!e.target.classList.contains("select-chip")) return;
    $$("#f-priority-group .select-chip").forEach((c) => c.classList.remove("active"));
    e.target.classList.add("active");
    selPriority = e.target.dataset.val;
  });
  $("#save-task").addEventListener("click", async () => {
    const title = $("#f-title").value.trim();
    if (!title) { toast("צריך להזין תיאור למשימה"); return; }
    const dueRaw = $("#f-due").value;
    const dueAt = dueRaw ? new Date(dueRaw).getTime() : null;
    const repeatMinutes = $("#f-repeat").value ? parseInt($("#f-repeat").value) : null;
    let reminder = null;
    if (dueAt) {
      reminder = { enabled: true, repeatMinutes, lastFiredAt: null };
      await ensureNotificationPermission();
    }
    const payload = {
      title,
      type: selType,
      priority: selPriority,
      buildingId: $("#f-building").value || null,
      floorId: $("#f-floor").value || null,
      budgetCode: $("#f-budget").value.trim(),
      dueAt,
      reminder,
      hold: dueAt ? (task ? task.hold : false) : false,
    };
    let savedId;
    if (task) {
      Store.updateTask(task.id, payload);
      savedId = task.id;
      toast("המשימה עודכנה");
    } else {
      const created = Store.addTask(payload);
      savedId = created.id;
      toast("המשימה נוספה");
    }
    syncCloudReminder(savedId);
    closeSheet();
    renderTasks();
    updateUrgentBanner();
  });
  if (task) {
    $("#delete-task").addEventListener("click", async () => {
      const ok = await confirmDialog("מחיקת משימה", "למחוק את המשימה?", "מחיקה");
      if (ok) {
        Store.deleteTask(task.id);
        window.CloudSync && window.CloudSync.removeReminder(task.id);
        closeSheet();
        renderTasks();
        toast("המשימה נמחקה");
      }
    });
  }
}

async function ensureNotificationPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    const ok = await confirmDialog("הפעלת התראות", "כדי לקבל תזכורות בטלפון צריך לאשר התראות לאפליקציה. לאשר עכשיו?", "אישור התראות", false);
    if (ok) {
      try { await Notification.requestPermission(); } catch (e) {}
      updateNotifPermissionLabel();
    }
  }
  if (Notification.permission === "granted") {
    await subscribeToPush();
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}
async function subscribeToPush() {
  if (!window.CloudSync || !window.CloudSync.enabled) return;
  if (!window.CLOUD_VAPID_PUBLIC_KEY || window.CLOUD_VAPID_PUBLIC_KEY === "YOUR_VAPID_PUBLIC_KEY") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(window.CLOUD_VAPID_PUBLIC_KEY),
      });
    }
    await window.CloudSync.saveSubscription(sub);
    toast("תזכורות בענן חוברו למכשיר הזה ✓");
  } catch (e) {
    console.error("push subscribe failed", e);
  }
}
// keeps the cloud copy of a task's reminder in sync (creates/updates/deletes as needed)
function syncCloudReminder(taskId) {
  if (!window.CloudSync) return;
  const t = Store.data.tasks.find((x) => x.id === taskId);
  if (!t) { window.CloudSync.removeReminder(taskId); return; }
  window.CloudSync.upsertReminder(Object.assign({}, t, { locationLabel: locationLabel(t) || "" }));
}

async function openSnoozeDialog(taskId) {
  const r = await showDialog({
    title: "נודניק",
    message: "לדחות את התזכורת ל...",
    buttons: [
      { label: "ביטול", value: null, style: "ghost" },
      { label: "15 דקות", value: 15, style: "" },
      { label: "שעה", value: 60, style: "" },
      { label: "מחר באותה שעה", value: "tomorrow", style: "primary" },
    ],
  });
  if (!r || r.value === null || typeof r.value === "undefined") return;
  if (r.value === "tomorrow") {
    const t = Store.data.tasks.find((x) => x.id === taskId);
    const base = t && t.dueAt ? new Date(t.dueAt) : new Date();
    Store.snoozeTask(taskId, Math.round((base.getTime() + 24 * 3600000 - Date.now()) / 60000));
  } else {
    Store.snoozeTask(taskId, r.value);
  }
  toast("התזכורת נדחתה");
  renderTasks();
}

function wireCardActions(container, kind) {
  container.addEventListener("click", async (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.dataset.action === "cycle-status" && kind === "task") {
      const t = Store.data.tasks.find((x) => x.id === id);
      const next = { open: "in_progress", in_progress: "done", done: "open" };
      Store.updateTask(id, { status: next[t.status] });
      renderTasks();
      return;
    }
    if (e.target.dataset.action === "complete") {
      Store.completeTask(id); syncCloudReminder(id); renderTasks(); updateUrgentBanner(); toast("המשימה הושלמה ✓"); return;
    }
    if (e.target.dataset.action === "snooze") { await openSnoozeDialog(id); syncCloudReminder(id); updateUrgentBanner(); return; }
    if (e.target.dataset.action === "toggle-hold") {
      const t = Store.data.tasks.find((x) => x.id === id);
      Store.setTaskHold(id, !t.hold);
      syncCloudReminder(id);
      renderTasks();
      updateUrgentBanner();
      return;
    }
    if (e.target.dataset.action === "toggle-budget") {
      const val = card.querySelector(".budget-value");
      val.classList.toggle("show");
      return;
    }
    if (e.target.dataset.action === "edit") {
      if (kind === "task") openTaskForm(id);
      return;
    }
    if (e.target.dataset.action === "delete") {
      if (kind === "task") {
        const ok = await confirmDialog("מחיקת משימה", "למחוק את המשימה?", "מחיקה");
        if (ok) { Store.deleteTask(id); window.CloudSync && window.CloudSync.removeReminder(id); renderTasks(); toast("נמחק"); }
      }
      return;
    }
    if (e.target.dataset.action === "add-note") {
      const text = await promptDialog("הערה חדשה", "טקסט ההערה");
      if (text) {
        if (kind === "task") { Store.addTaskNote(id, text); renderTasks(); }
      }
      return;
    }
    if (e.target.dataset.note) {
      if (kind === "task") { Store.deleteTaskNote(id, e.target.dataset.note); renderTasks(); }
      return;
    }
    // clicking the card itself (not a button) opens edit
    if (!e.target.closest("button") && !e.target.classList.contains("status-dot") && !e.target.closest(".drag-handle")) {
      if (kind === "task") openTaskForm(id);
    }
  });
}

// ==========================================================
// ORDERS
// ==========================================================
const ORDER_STEPS = [
  { key: "pending", label: "לא הוזמן" },
  { key: "ordered", label: "הוזמן" },
  { key: "arrived", label: "הגיע" },
  { key: "installed", label: "הותקן" },
];
const ORDERS_SORT_OPTIONS = [
  { value: "default", label: "ברירת מחדל (חדש קודם)" },
  { value: "alpha", label: "לפי א-ב" },
  { value: "category", label: "לפי קטגוריה" },
  { value: "status", label: "לפי שלב הזמנה" },
  { value: "manual", label: "סדר ידני (גרירה)" },
];

function renderOrders() {
  const list = $("#orders-list");
  let items = [...Store.data.orders];
  if (state.orderStatusFilter !== "all") items = items.filter((o) => o.status === state.orderStatusFilter);
  if (state.ordersSort === "default") items.sort((a, b) => b.createdAt - a.createdAt);
  else items = sortItems(items, state.ordersSort, "order");
  $("#orders-count").textContent = `${items.length} פריטים`;

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">📦</div><p>אין הזמנות להצגה.<br>לחץ על + כדי להוסיף פריט להזמנה.</p></div>`;
    return;
  }

  list.innerHTML = items.map((o) => {
    const loc = locationLabel(o);
    const budget = buildingBudgetFor(o) || o.budgetCode;
    const stepIdx = ORDER_STEPS.findIndex((s) => s.key === o.status);
    return `
    <div class="card" data-id="${o.id}" data-reorder-item>
      <div class="card-top">
        <span class="drag-handle">⠿</span>
        <div class="card-title">${esc(o.title)} ${o.qty > 1 ? `<span class="mono" style="color:var(--text-dim);font-size:13px">×${o.qty}</span>` : ""}</div>
      </div>
      <div class="card-meta">
        <span class="tag type">${esc(o.category)}</span>
        ${loc ? `<span class="tag loc">📍 ${esc(loc)}</span>` : ""}
      </div>
      ${o.notes ? `<div class="card-notes"><div class="note-line"><span>${esc(o.notes)}</span></div></div>` : ""}
      ${o.budgetCode || budget ? `<button class="budget-toggle" data-action="toggle-budget">💰 סעיף תקציבי</button><div class="budget-value">קוד: <b>${esc(o.budgetCode || budget)}</b></div>` : ""}
      <div class="order-steps">
        ${ORDER_STEPS.map((s, i) => `<div class="order-step ${i <= stepIdx ? "active" : ""}" data-step="${s.key}">${s.label}</div>`).join("")}
      </div>
      <div class="card-actions">
        <button data-action="edit">✏️ ערוך</button>
        <button data-action="delete" class="danger">🗑 מחק</button>
      </div>
    </div>`;
  }).join("");
}
async function ordersClickHandler(e) {
  const card = e.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;
  if (e.target.dataset.step) {
    Store.updateOrder(id, { status: e.target.dataset.step });
    renderOrders();
    return;
  }
  if (e.target.dataset.action === "toggle-budget") {
    card.querySelector(".budget-value").classList.toggle("show");
    return;
  }
  if (e.target.dataset.action === "edit") { openOrderForm(id); return; }
  if (e.target.dataset.action === "delete") {
    const ok = await confirmDialog("מחיקת הזמנה", "למחוק את ההזמנה?", "מחיקה");
    if (ok) { Store.deleteOrder(id); renderOrders(); toast("נמחק"); }
    return;
  }
  if (!e.target.closest("button") && !e.target.closest(".drag-handle") && !e.target.closest(".order-step")) openOrderForm(id);
}
$$("#orders-status-filter .chip").forEach((c) => c.addEventListener("click", () => {
  $$("#orders-status-filter .chip").forEach((x) => x.classList.remove("active"));
  c.classList.add("active");
  state.orderStatusFilter = c.dataset.status;
  renderOrders();
}));
$("#orders-list").addEventListener("click", ordersClickHandler);
$("#orders-sort-btn").addEventListener("click", (e) => {
  openSortMenu(e.currentTarget, state.ordersSort, ORDERS_SORT_OPTIONS, (val) => {
    state.ordersSort = val; Store.setUiPref("ordersSort", val); renderOrders();
  });
});
enableLongPressReorder($("#orders-list"), "[data-reorder-item]", (ids) => {
  Store.reorderOrders(ids);
  if (state.ordersSort !== "manual") { state.ordersSort = "manual"; Store.setUiPref("ordersSort", "manual"); }
  renderOrders();
});

function orderFormHTML(order) {
  const isEdit = !!order;
  order = order || { title: "", category: Store.data.orderCategories[0] || "", qty: 1, buildingId: "", floorId: "", budgetCode: "", notes: "" };
  return `
    <h3>${isEdit ? "עריכת הזמנה" : "פריט חדש להזמנה"}</h3>
    <div class="field">
      <label>מה צריך להזמין</label>
      <input type="text" id="f-title" value="${esc(order.title)}" placeholder="לדוגמה: כבל NYY 3×2.5" autofocus>
    </div>
    <div class="field-row">
      <div class="field">
        <label>קטגוריה</label>
        <div id="f-category-wrap"></div>
      </div>
      <div class="field">
        <label>כמות</label>
        <input type="number" id="f-qty" value="${order.qty || 1}" min="1">
      </div>
    </div>
    ${buildingSelectHTML(order.buildingId, order.floorId)}
    <div class="field">
      <label>הערה (אופציונלי)</label>
      <textarea id="f-notes" placeholder="פרטים נוספים...">${esc(order.notes)}</textarea>
    </div>
    ${budgetFieldHTML(order.budgetCode)}
    <button class="btn-primary" id="save-order">${isEdit ? "שמירה" : "הוספה לרשימה"}</button>
    ${isEdit ? `<button class="btn-danger" id="delete-order">מחיקה</button>` : ""}
  `;
}
function openOrderForm(orderId, presetLocation) {
  const order = orderId ? Store.data.orders.find((o) => o.id === orderId) : null;
  openSheet(orderFormHTML(order));
  wireFloorSelect(order ? order.buildingId : (presetLocation && presetLocation.buildingId), order ? order.floorId : (presetLocation && presetLocation.floorId));
  if (presetLocation && !order) {
    $("#f-building").value = presetLocation.buildingId || "";
    wireFloorSelect(presetLocation.buildingId, presetLocation.floorId);
    setTimeout(() => { if ($("#f-floor")) $("#f-floor").value = presetLocation.floorId || ""; }, 0);
  }
  let selCategory = order ? order.category : Store.data.orderCategories[0];
  wireCategoryChipGroup($("#f-category-wrap"), "f-category-group", {
    getItems: () => Store.data.orderCategories,
    getUsage: (name) => Store.usageOfOrderCategory(name),
    addFn: (name) => Store.addOrderCategory(name),
    deleteFn: (name, mode) => Store.deleteOrderCategory(name, mode),
    getSelected: () => selCategory,
    onSelect: (val) => { selCategory = val; },
  });
  $("#save-order").addEventListener("click", () => {
    const title = $("#f-title").value.trim();
    if (!title) { toast("צריך להזין שם פריט"); return; }
    const payload = {
      title,
      category: selCategory,
      qty: parseInt($("#f-qty").value) || 1,
      buildingId: $("#f-building").value || null,
      floorId: $("#f-floor").value || null,
      notes: $("#f-notes").value.trim(),
      budgetCode: $("#f-budget").value.trim(),
    };
    if (order) { Store.updateOrder(order.id, payload); toast("עודכן"); }
    else { Store.addOrder(payload); toast("נוסף לרשימת ההזמנות"); }
    closeSheet();
    renderOrders();
  });
  if (order) {
    $("#delete-order").addEventListener("click", async () => {
      const ok = await confirmDialog("מחיקת הזמנה", "למחוק?", "מחיקה");
      if (ok) { Store.deleteOrder(order.id); closeSheet(); renderOrders(); toast("נמחק"); }
    });
  }
}

// ==========================================================
// BUILDINGS
// ==========================================================
const BUILDINGS_SORT_OPTIONS = [
  { value: "default", label: "סדר ידני (גרירה)" },
  { value: "alpha", label: "לפי א-ב" },
];
function renderBuildings() {
  const list = $("#buildings-list");
  let buildings = [...Store.data.buildings];
  if (state.buildingsSort === "alpha") buildings.sort((a, b) => a.name.localeCompare(b.name, "he"));
  else buildings.sort((a, b) => a.order - b.order);
  $("#buildings-count").textContent = `${buildings.length} בניינים`;
  if (!buildings.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">🏢</div><p>עדיין לא נוספו בניינים.<br>הוסף בניין כדי לשייך אליו משימות והזמנות.</p></div>`;
    return;
  }
  list.innerHTML = buildings.map((b) => `
    <div class="building-block" data-id="${b.id}" data-reorder-item>
      <div class="building-head" data-action="toggle">
        <div class="name"><span class="drag-handle">⠿</span> 🏢 ${esc(b.name)}</div>
        <div class="arrow">⌄</div>
      </div>
      <div class="floor-list">
        ${b.budgetCode ? `<button class="budget-toggle" data-action="toggle-budget">💰 סעיף תקציבי כללי לבניין</button><div class="budget-value">קוד: <b>${esc(b.budgetCode)}</b></div>` : ""}
        <div class="link-row" data-action="open-building-notes" style="cursor:pointer">
          <span>📝 הערות ומשימות כלליות לבניין</span><span>›</span>
        </div>
        <div class="floor-rows-wrap" data-building="${b.id}">
        ${b.floors.map((f) => `
          <div class="floor-row" data-id="${f.id}" data-reorder-item>
            <span class="drag-handle">⠿</span>
            <span class="floor-name-tap" data-action="open-floor">${esc(f.name)} ${f.budgetCode ? `<span class="mono" style="color:var(--text-dim);font-size:11px">(${esc(f.budgetCode)})</span>` : ""}</span>
            <span>
              <button data-action="edit-floor" data-floor="${f.id}">✏️</button>
              <button data-action="delete-floor" data-floor="${f.id}">🗑</button>
            </span>
          </div>
        `).join("")}
        </div>
        <button class="add-floor-btn" data-action="add-floor">+ הוספת קומה</button>
        <button class="btn-secondary" data-action="edit-building" style="margin-top:10px">✏️ עריכת פרטי בניין</button>
        <button class="btn-danger" data-action="delete-building">🗑 מחיקת בניין</button>
      </div>
    </div>
  `).join("");
  $$(".floor-rows-wrap", list).forEach((wrap) => {
    enableLongPressReorder(wrap, "[data-reorder-item]", (ids) => {
      Store.reorderFloors(wrap.dataset.building, ids);
      renderBuildings();
      // keep the block open after re-render
      const block = $(`.building-block[data-id="${wrap.dataset.building}"]`);
      if (block) block.classList.add("open");
    });
  });
}
async function buildingsClickHandler(e) {
  const block = e.target.closest(".building-block");
  if (!block) return;
  const bid = block.dataset.id;
  const action = e.target.dataset.action || (e.target.closest("[data-action]") && e.target.closest("[data-action]").dataset.action);
  if (action === "toggle" || (!action && e.target.closest(".building-head"))) {
    block.classList.toggle("open");
    return;
  }
  if (action === "toggle-budget") { e.target.nextElementSibling.classList.toggle("show"); return; }
  if (action === "open-building-notes") { openLocationDetail(bid, null); return; }
  if (action === "open-floor") {
    const row = e.target.closest(".floor-row");
    openLocationDetail(bid, row.dataset.id);
    return;
  }
  if (action === "add-floor") {
    const name = await promptDialog("קומה חדשה", "שם הקומה", "", "לדוגמה: קומה 3");
    if (name) { Store.addFloor(bid, name); renderBuildings(); const b = $(`.building-block[data-id="${bid}"]`); if (b) b.classList.add("open"); toast("הקומה נוספה"); }
    return;
  }
  if (action === "edit-floor") {
    const fid = e.target.dataset.floor;
    const b = Store.data.buildings.find((x) => x.id === bid);
    const f = b.floors.find((x) => x.id === fid);
    const name = await promptDialog("שם הקומה", "שם", f.name);
    if (name === null) return;
    const budget = await promptDialog("סעיף תקציבי לקומה", "קוד (ריק = ללא)", f.budgetCode || "");
    Store.updateFloor(bid, fid, { name: name || f.name, budgetCode: (budget || "").trim() });
    renderBuildings();
    const blk = $(`.building-block[data-id="${bid}"]`); if (blk) blk.classList.add("open");
    return;
  }
  if (action === "delete-floor") {
    const ok = await confirmDialog("מחיקת קומה", "למחוק את הקומה? הערות המיקום שלה יימחקו גם כן.", "מחיקה");
    if (ok) { Store.deleteFloor(bid, e.target.dataset.floor); renderBuildings(); const blk = $(`.building-block[data-id="${bid}"]`); if (blk) blk.classList.add("open"); }
    return;
  }
  if (action === "edit-building") { openBuildingForm(bid); return; }
  if (action === "delete-building") {
    const ok = await confirmDialog("מחיקת בניין", "למחוק את הבניין? משימות/הזמנות משויכות יישארו אך יתנתקו מהבניין.", "מחיקה");
    if (ok) {
      Store.deleteBuilding(bid);
      renderBuildings();
      toast("הבניין נמחק");
    }
    return;
  }
}
function buildingFormHTML(b) {
  b = b || { name: "", budgetCode: "" };
  return `
    <h3>${b.name === "" ? "בניין חדש" : "עריכת בניין"}</h3>
    <div class="field"><label>שם הבניין</label><input type="text" id="f-name" value="${esc(b.name)}" placeholder="לדוגמה: בניין A" autofocus></div>
    ${budgetFieldHTML(b.budgetCode)}
    <button class="btn-primary" id="save-building">שמירה</button>
  `;
}
function openBuildingForm(bid) {
  const b = bid ? Store.data.buildings.find((x) => x.id === bid) : null;
  openSheet(buildingFormHTML(b));
  $("#save-building").addEventListener("click", () => {
    const name = $("#f-name").value.trim();
    if (!name) { toast("צריך להזין שם בניין"); return; }
    const budgetCode = $("#f-budget").value.trim();
    if (b) Store.updateBuilding(b.id, { name, budgetCode });
    else Store.addBuilding(name, budgetCode);
    closeSheet();
    renderBuildings();
    toast("נשמר");
  });
}
$("#add-building-btn").addEventListener("click", () => openBuildingForm(null));
$("#buildings-list").addEventListener("click", buildingsClickHandler);
$("#buildings-sort-btn").addEventListener("click", (e) => {
  openSortMenu(e.currentTarget, state.buildingsSort, BUILDINGS_SORT_OPTIONS, (val) => {
    state.buildingsSort = val; Store.setUiPref("buildingsSort", val); renderBuildings();
  });
});
enableLongPressReorder($("#buildings-list"), "[data-reorder-item]", (ids) => {
  Store.reorderBuildings(ids);
  state.buildingsSort = "default"; Store.setUiPref("buildingsSort", "default");
  renderBuildings();
});

// ==========================================================
// LOCATION DETAIL — notes + tasks + orders for a specific building/floor
// ==========================================================
let locTab = "notes";
function locationDetailHTML(buildingId, floorId) {
  const b = Store.data.buildings.find((x) => x.id === buildingId);
  const label = floorId ? `${b.name} · ${floorName(buildingId, floorId)}` : `${b.name} (כללי לבניין)`;
  const { tasks, orders, notes } = Store.itemsForLocation(buildingId, floorId);
  return `
    <h3>📍 ${esc(label)}</h3>
    <div class="loc-tabs">
      <div class="loc-tab ${locTab === "notes" ? "active" : ""}" data-tab="notes">הערות (${notes.length})</div>
      <div class="loc-tab ${locTab === "tasks" ? "active" : ""}" data-tab="tasks">משימות (${tasks.length})</div>
      <div class="loc-tab ${locTab === "orders" ? "active" : ""}" data-tab="orders">הזמנות (${orders.length})</div>
    </div>
    <div class="loc-panel ${locTab === "notes" ? "active" : ""}" data-panel="notes">
      <div class="inline-add">
        <input type="text" id="loc-note-input" placeholder="הערה חדשה למיקום זה...">
        <button id="loc-note-add">הוסף</button>
      </div>
      <p class="hint-text">לחיצה ארוכה על הערה מזיזה את הסדר.</p>
      <div id="loc-notes-list">
        ${notes.length ? notes.map((n) => `
          <div class="loc-mini-card" data-id="${n.id}" data-reorder-item>
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <span class="drag-handle">⠿</span>
              <span style="flex:1">${esc(n.text)}</span>
              <button class="note-del" data-del-note="${n.id}">✕</button>
            </div>
            <div class="sub">${timeAgo(n.createdAt)}</div>
          </div>
        `).join("") : `<p style="color:var(--text-dim);font-size:13.5px">אין הערות עדיין למיקום זה.</p>`}
      </div>
    </div>
    <div class="loc-panel ${locTab === "tasks" ? "active" : ""}" data-panel="tasks">
      <button class="btn-secondary" id="loc-add-task">+ משימה חדשה במיקום זה</button>
      ${tasks.length ? tasks.map((t) => `
        <div class="loc-mini-card" data-open-task="${t.id}" style="cursor:pointer">
          <b>${esc(t.title)}</b>
          <div class="sub">${t.status === "done" ? "✅ בוצע" : t.status === "in_progress" ? "🟡 בביצוע" : "⚪ פתוח"} · ${esc(t.type)}</div>
        </div>
      `).join("") : `<p style="color:var(--text-dim);font-size:13.5px;margin-top:10px">אין משימות במיקום זה.</p>`}
    </div>
    <div class="loc-panel ${locTab === "orders" ? "active" : ""}" data-panel="orders">
      <button class="btn-secondary" id="loc-add-order">+ פריט הזמנה במיקום זה</button>
      ${orders.length ? orders.map((o) => `
        <div class="loc-mini-card" data-open-order="${o.id}" style="cursor:pointer">
          <b>${esc(o.title)}</b>
          <div class="sub">${esc(ORDER_STEPS.find((s) => s.key === o.status).label)} · ${esc(o.category)}</div>
        </div>
      `).join("") : `<p style="color:var(--text-dim);font-size:13.5px;margin-top:10px">אין הזמנות במיקום זה.</p>`}
    </div>
  `;
}
function openLocationDetail(buildingId, floorId) {
  locTab = "notes";
  renderLocationDetail(buildingId, floorId);
}
function renderLocationDetail(buildingId, floorId) {
  openSheet(locationDetailHTML(buildingId, floorId));
  $$(".loc-tab").forEach((t) => t.addEventListener("click", () => { locTab = t.dataset.tab; renderLocationDetail(buildingId, floorId); }));
  $("#loc-note-add").addEventListener("click", () => {
    const input = $("#loc-note-input");
    const text = input.value.trim();
    if (!text) return;
    Store.addLocationNote(buildingId, floorId, text);
    renderLocationDetail(buildingId, floorId);
    toast("הערה נוספה");
  });
  $("#loc-note-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#loc-note-add").click(); });
  $$("[data-del-note]").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog("מחיקת הערה", "למחוק את ההערה?", "מחיקה");
    if (ok) { Store.deleteLocationNote(btn.dataset.delNote); renderLocationDetail(buildingId, floorId); }
  }));
  const notesList = $("#loc-notes-list");
  if (notesList) {
    enableLongPressReorder(notesList, "[data-reorder-item]", (ids) => {
      Store.reorderLocationNotes(buildingId, floorId, ids);
      renderLocationDetail(buildingId, floorId);
    });
  }
  const addTaskBtn = $("#loc-add-task");
  if (addTaskBtn) addTaskBtn.addEventListener("click", () => openTaskForm(null, { buildingId, floorId }));
  const addOrderBtn = $("#loc-add-order");
  if (addOrderBtn) addOrderBtn.addEventListener("click", () => openOrderForm(null, { buildingId, floorId }));
  $$("[data-open-task]").forEach((el) => el.addEventListener("click", () => openTaskForm(el.dataset.openTask)));
  $$("[data-open-order]").forEach((el) => el.addEventListener("click", () => openOrderForm(el.dataset.openOrder)));
}

// ==========================================================
// QUESTIONS
// ==========================================================
const QUESTIONS_SORT_OPTIONS = [
  { value: "default", label: "ברירת מחדל (חדש קודם)" },
  { value: "alpha", label: "לפי א-ב" },
  { value: "manual", label: "סדר ידני (גרירה)" },
];
function renderQuestions() {
  const list = $("#questions-list");
  let items = [...Store.data.questions];
  if (state.questionStatusFilter !== "all") items = items.filter((q) => q.status === state.questionStatusFilter);
  if (state.questionsSort === "default") items.sort((a, b) => b.createdAt - a.createdAt);
  else items = sortItems(items, state.questionsSort, "question");
  $("#questions-count").textContent = `${items.length} פריטים`;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">❓</div><p>אין שאלות פתוחות.<br>כאן ריכזת שאלות/בעיות שדורשות בירור מול אחרים.</p></div>`;
    return;
  }
  list.innerHTML = items.map((q) => `
    <div class="card ${q.status === "answered" ? "done" : ""}" data-id="${q.id}" data-reorder-item>
      <div class="card-top">
        <span class="drag-handle">⠿</span>
        <div class="status-dot ${q.status === "answered" ? "done" : "open"}" data-action="toggle-status"></div>
        <div class="card-title">${esc(q.text)}</div>
      </div>
      ${q.relatedTo ? `<div class="card-meta"><span class="tag">👤 ${esc(q.relatedTo)}</span></div>` : ""}
      ${q.answer ? `<div class="card-notes"><div class="note-line"><span>💬 ${esc(q.answer)}</span></div></div>` : ""}
      <div class="card-actions">
        <button data-action="answer">💬 ${q.answer ? "עריכת תשובה" : "הוספת תשובה"}</button>
        <button data-action="edit">✏️ ערוך</button>
        <button data-action="delete" class="danger">🗑 מחק</button>
      </div>
    </div>
  `).join("");
}
async function questionsClickHandler(e) {
  const card = e.target.closest(".card");
  if (!card) return;
  const id = card.dataset.id;
  const q = Store.data.questions.find((x) => x.id === id);
  if (e.target.dataset.action === "toggle-status") {
    Store.updateQuestion(id, { status: q.status === "answered" ? "open" : "answered" });
    renderQuestions();
    return;
  }
  if (e.target.dataset.action === "answer") {
    const ans = await promptDialog("תשובה / סיכום", "תשובה", q.answer || "");
    if (ans !== null) { Store.updateQuestion(id, { answer: ans, status: ans ? "answered" : q.status }); renderQuestions(); }
    return;
  }
  if (e.target.dataset.action === "edit") { openQuestionForm(id); return; }
  if (e.target.dataset.action === "delete") {
    const ok = await confirmDialog("מחיקת שאלה", "למחוק?", "מחיקה");
    if (ok) { Store.deleteQuestion(id); renderQuestions(); toast("נמחק"); }
    return;
  }
  if (!e.target.closest("button") && !e.target.closest(".drag-handle")) openQuestionForm(id);
}
$$("#questions-status-filter .chip").forEach((c) => c.addEventListener("click", () => {
  $$("#questions-status-filter .chip").forEach((x) => x.classList.remove("active"));
  c.classList.add("active");
  state.questionStatusFilter = c.dataset.status;
  renderQuestions();
}));
$("#questions-list").addEventListener("click", questionsClickHandler);
$("#questions-sort-btn").addEventListener("click", (e) => {
  openSortMenu(e.currentTarget, state.questionsSort, QUESTIONS_SORT_OPTIONS, (val) => {
    state.questionsSort = val; Store.setUiPref("questionsSort", val); renderQuestions();
  });
});
enableLongPressReorder($("#questions-list"), "[data-reorder-item]", (ids) => {
  Store.reorderQuestions(ids);
  if (state.questionsSort !== "manual") { state.questionsSort = "manual"; Store.setUiPref("questionsSort", "manual"); }
  renderQuestions();
});
function questionFormHTML(q) {
  q = q || { text: "", relatedTo: "" };
  return `
    <h3>${q.text === "" ? "שאלה / בעיה חדשה" : "עריכת שאלה"}</h3>
    <div class="field"><label>מה השאלה / הבעיה</label><textarea id="f-text" placeholder="לדוגמה: לבדוק מול קבלן הבטון לגבי מיקום שרוולים בקומה 2" autofocus>${esc(q.text)}</textarea></div>
    <div class="field"><label>קשור ל (אופציונלי)</label><input type="text" id="f-related" value="${esc(q.relatedTo)}" placeholder="לדוגמה: קבלן בטון / מתכנן חשמל"></div>
    <button class="btn-primary" id="save-question">שמירה</button>
  `;
}
function openQuestionForm(qid) {
  const q = qid ? Store.data.questions.find((x) => x.id === qid) : null;
  openSheet(questionFormHTML(q));
  $("#save-question").addEventListener("click", () => {
    const text = $("#f-text").value.trim();
    if (!text) { toast("צריך להזין תוכן"); return; }
    const payload = { text, relatedTo: $("#f-related").value.trim() };
    if (q) Store.updateQuestion(q.id, payload);
    else Store.addQuestion(payload);
    closeSheet();
    renderQuestions();
    toast("נשמר");
  });
}

// ==========================================================
// MORE: general notes, categories, backup
// ==========================================================
function renderGeneralNotes() {
  const list = $("#general-notes-list");
  const items = [...Store.data.generalNotes].sort((a, b) => a.order - b.order);
  if (!items.length) { list.innerHTML = `<div class="empty-state" style="padding:20px"><p>אין הערות כלליות.</p></div>`; return; }
  list.innerHTML = items.map((n) => `
    <div class="card" data-id="${n.id}" data-reorder-item style="padding:12px">
      <div class="note-line" style="font-size:14px;color:var(--text)">
        <span class="drag-handle">⠿</span>
        <span style="flex:1">${esc(n.text)}</span>
        <button class="note-del" data-action="delete-note">✕</button>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${timeAgo(n.createdAt)}</div>
    </div>
  `).join("");
  list.onclick = async (e) => {
    if (e.target.dataset.action === "delete-note") {
      const id = e.target.closest(".card").dataset.id;
      const ok = await confirmDialog("מחיקת הערה", "למחוק את ההערה?", "מחיקה");
      if (ok) { Store.deleteGeneralNote(id); renderGeneralNotes(); }
    }
  };
  enableLongPressReorder(list, "[data-reorder-item]", (ids) => { Store.reorderGeneralNotes(ids); renderGeneralNotes(); });
}
$("#general-note-add").addEventListener("click", () => {
  const input = $("#general-note-input");
  const text = input.value.trim();
  if (!text) return;
  Store.addGeneralNote(text);
  input.value = "";
  renderGeneralNotes();
  toast("הערה נוספה");
});
$("#general-note-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#general-note-add").click();
});

function categoryManagerHTML(title, items) {
  return `
    <h3>${esc(title)}</h3>
    <div id="cat-list">
      ${items.map((c) => `<div class="link-row" data-id="${esc(c)}"><span>${esc(c)}</span><button class="del" data-cat="${esc(c)}">מחק</button></div>`).join("") || `<p style="color:var(--text-dim);font-size:14px">אין פריטים עדיין</p>`}
    </div>
    <div class="inline-add">
      <input type="text" id="new-cat-input" placeholder="קטגוריה חדשה...">
      <button id="new-cat-add">הוסף</button>
    </div>
  `;
}
$("#manage-task-types").addEventListener("click", () => {
  openSheet(categoryManagerHTML("סוגי משימות", Store.data.taskTypes));
  wireCategoryManager(() => Store.data.taskTypes, (v) => Store.addTaskType(v), (v, mode) => Store.deleteTaskType(v, mode), (v) => Store.usageOfTaskType(v), "סוגי משימות");
});
$("#manage-order-categories").addEventListener("click", () => {
  openSheet(categoryManagerHTML("קטגוריות הזמנה", Store.data.orderCategories));
  wireCategoryManager(() => Store.data.orderCategories, (v) => Store.addOrderCategory(v), (v, mode) => Store.deleteOrderCategory(v, mode), (v) => Store.usageOfOrderCategory(v), "קטגוריות הזמנה");
});
function wireCategoryManager(getItems, addFn, delFn, usageFn, title) {
  $("#new-cat-add").addEventListener("click", () => {
    const input = $("#new-cat-input");
    const val = input.value.trim();
    if (!val) return;
    addFn(val);
    openSheet(categoryManagerHTML(title, getItems()));
    wireCategoryManager(getItems, addFn, delFn, usageFn, title);
    toast("נוסף");
  });
  $$("#cat-list .del").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const name = btn.dataset.cat;
    const usage = usageFn(name);
    let mode = "reassign";
    if (usage.length > 0) {
      const choice = await chooseDialog(
        `מחיקת "${name}"`,
        `יש ${usage.length} פריטים תחת הקטגוריה הזו. מה לעשות איתם?`,
        [
          { label: "ביטול", value: "cancel", style: "ghost" },
          { label: `העברה ל"${GENERAL_CATEGORY}"`, value: "reassign", style: "primary" },
          { label: "מחיקת כל הפריטים", value: "delete", style: "danger" },
        ]
      );
      if (!choice || choice === "cancel") return;
      mode = choice;
    } else {
      const ok = await confirmDialog(`מחיקת "${name}"`, "אין פריטים תחת קטגוריה זו. למחוק?", "מחיקה");
      if (!ok) return;
    }
    delFn(name, mode);
    openSheet(categoryManagerHTML(title, getItems()));
    wireCategoryManager(getItems, addFn, delFn, usageFn, title);
    renderAllListsQuiet();
    toast(mode === "delete" ? "הקטגוריה והפריטים נמחקו" : "נמחק");
  }));
}

// Backup / restore
$("#export-data").addEventListener("click", () => {
  const json = Store.exportJSON();
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `גיבוי-אתר-חשמל-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("קובץ הגיבוי הורד — שתף/העבר אותו למכשיר השני");
});
$("#import-data").addEventListener("click", () => $("#import-file-input").click());
$("#import-file-input").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const ok = await confirmDialog("ייבוא גיבוי", "ייבוא הגיבוי יחליף את כל הנתונים הקיימים במכשיר זה. להמשיך?", "ייבוא");
      if (!ok) return;
      Store.importJSON(reader.result);
      Object.assign(state, {
        tasksSort: Store.data.uiPrefs.tasksSort,
        ordersSort: Store.data.uiPrefs.ordersSort,
        questionsSort: Store.data.uiPrefs.questionsSort,
        buildingsSort: Store.data.uiPrefs.buildingsSort,
      });
      renderAll();
      toast("הנתונים שוחזרו בהצלחה");
    } catch (err) {
      toast("קובץ לא תקין");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});
$("#wipe-data").addEventListener("click", async () => {
  const ok1 = await confirmDialog("מחיקת כל הנתונים", "פעולה זו תמחק את כל הנתונים במכשיר לצמיתות. להמשיך?", "המשך");
  if (!ok1) return;
  const ok2 = await confirmDialog("אישור אחרון", "בטוח לגמרי? אין אפשרות לשחזר לאחר מכן (אלא אם יש גיבוי).", "מחק הכל");
  if (!ok2) return;
  Store.wipeAll();
  renderAll();
  toast("כל הנתונים נמחקו");
});

// Notification permission UI
function updateNotifPermissionLabel() {
  const el = $("#notif-permission-status");
  if (!("Notification" in window)) { el.textContent = "לא נתמך בדפדפן זה"; return; }
  const map = { granted: "✅ מופעל", denied: "❌ נחסם — יש לאשר בהגדרות הדפדפן", default: "להפעלה ›" };
  el.textContent = map[Notification.permission] || "›";
}
$("#notif-permission-row").addEventListener("click", async () => {
  if (!("Notification" in window)) { toast("הדפדפן לא תומך בהתראות"); return; }
  if (Notification.permission === "default") {
    await Notification.requestPermission();
    updateNotifPermissionLabel();
    if (Notification.permission === "granted") await subscribeToPush();
  } else if (Notification.permission === "denied") {
    await alertDialog("התראות חסומות", "כדי להפעיל התראות יש לאשר אותן דרך הגדרות הדפדפן/הטלפון עבור האפליקציה הזו.");
  } else if (Notification.permission === "granted") {
    await subscribeToPush();
  }
});

function updateCloudStatusLabel() {
  const el = $("#cloud-status-label");
  if (!el || !window.CloudSync) { if (el) el.textContent = "לא מוגדר — ראה SETUP-CLOUD.md"; return; }
  const map = {
    idle: "לא מוגדר — ראה SETUP-CLOUD.md",
    unconfigured: "לא מוגדר — ראה SETUP-CLOUD.md",
    connecting: "מתחבר...",
    connected: "✅ מחובר",
    error: "⚠️ שגיאה — לחץ לפרטים",
  };
  el.textContent = map[window.CloudSync.status] || "›";
}
window.addEventListener("cloud-status", updateCloudStatusLabel);
window.addEventListener("cloud-ready", () => {
  updateCloudStatusLabel();
  if ("Notification" in window && Notification.permission === "granted") subscribeToPush();
});
$("#cloud-status-row").addEventListener("click", async () => {
  if (window.CloudSync && window.CloudSync.status === "error") {
    await alertDialog("שגיאת חיבור לענן", `הפרטים המדויקים: ${window.CloudSync.errorMessage || "לא ידוע"}\n\nהסיבות הנפוצות ביותר: "התחברות אנונימית" לא הופעלה ב-Firebase Authentication, או שחוקי ה-Firestore לא פורסמו (Publish). ראה SETUP-CLOUD.md.`);
    return;
  }
  if (window.CloudSync && window.CloudSync.enabled) {
    await subscribeToPush();
  } else {
    await alertDialog("תזכורות בענן", "כדי לאפשר תזכורות אמיתיות גם כשהאפליקציה סגורה, יש להגדיר חיבור חינמי ל-Firebase ול-GitHub Actions. ההוראות המלאות נמצאות בקובץ SETUP-CLOUD.md שצורף לאפליקציה.");
  }
});
updateCloudStatusLabel();

// ==========================================================
// FAB — context-aware "add" button
// ==========================================================
$("#fab-add").addEventListener("click", () => {
  switch (state.view) {
    case "tasks": openTaskForm(null); break;
    case "orders": openOrderForm(null); break;
    case "buildings": openBuildingForm(null); break;
    case "questions": openQuestionForm(null); break;
    case "more": $("#general-note-input").focus(); break;
  }
});

// ==========================================================
// Smart search — live results across everything, in a sheet
// ==========================================================
function highlight(text, terms) {
  let out = esc(text || "");
  terms.forEach((t) => {
    if (!t) return;
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return out;
}
function runSearch(query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return null;
  const matchAll = (fields) => {
    const hay = fields.join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  };
  const groups = [];

  const taskMatches = Store.data.tasks.filter((t) => matchAll([t.title, t.type, locationLabel(t) || "", ...t.notes.map((n) => n.text)]));
  if (taskMatches.length) groups.push({ title: "משימות", icon: "✅", items: taskMatches.map((t) => ({ title: t.title, sub: [t.type, locationLabel(t)].filter(Boolean).join(" · "), action: () => openTaskForm(t.id) })) });

  const orderMatches = Store.data.orders.filter((o) => matchAll([o.title, o.category, o.notes || "", locationLabel(o) || ""]));
  if (orderMatches.length) groups.push({ title: "הזמנות", icon: "📦", items: orderMatches.map((o) => ({ title: o.title, sub: [o.category, locationLabel(o)].filter(Boolean).join(" · "), action: () => openOrderForm(o.id) })) });

  const qMatches = Store.data.questions.filter((q) => matchAll([q.text, q.relatedTo || "", q.answer || ""]));
  if (qMatches.length) groups.push({ title: "שאלות ובעיות", icon: "❓", items: qMatches.map((q) => ({ title: q.text, sub: q.relatedTo || (q.answer ? "נענה" : "פתוח"), action: () => openQuestionForm(q.id) })) });

  const buildingMatches = [];
  Store.data.buildings.forEach((b) => {
    if (matchAll([b.name])) buildingMatches.push({ title: b.name, sub: `${b.floors.length} קומות`, action: () => { switchView("buildings"); toast("עבר לתצוגת בניינים"); } });
    b.floors.forEach((f) => {
      if (matchAll([b.name, f.name])) buildingMatches.push({ title: `${b.name} · ${f.name}`, sub: "קומה", action: () => openLocationDetail(b.id, f.id) });
    });
  });
  if (buildingMatches.length) groups.push({ title: "בניינים וקומות", icon: "🏢", items: buildingMatches });

  const locNoteMatches = Store.data.locationNotes.filter((n) => matchAll([n.text]));
  if (locNoteMatches.length) groups.push({ title: "הערות מיקום", icon: "📍", items: locNoteMatches.map((n) => {
    const b = Store.data.buildings.find((x) => x.id === n.buildingId);
    const label = b ? (n.floorId ? `${b.name} · ${floorName(b.id, n.floorId)}` : b.name) : "";
    return { title: n.text, sub: label, action: () => openLocationDetail(n.buildingId, n.floorId) };
  }) });

  const genNoteMatches = Store.data.generalNotes.filter((n) => matchAll([n.text]));
  if (genNoteMatches.length) groups.push({ title: "הערות כלליות", icon: "🗒️", items: genNoteMatches.map((n) => ({ title: n.text, sub: timeAgo(n.createdAt), action: () => switchView("more") })) });

  return { groups, terms };
}
function searchSheetHTML() {
  return `
    <div class="search-input-wrap">
      <input type="text" id="search-input" placeholder="חיפוש חכם בכל הרשימות...">
    </div>
    <div id="search-results"></div>
  `;
}
function openSearchSheet() {
  openSheet(searchSheetHTML());
  const input = $("#search-input");
  const results = $("#search-results");
  function render() {
    const q = input.value;
    if (!q.trim()) { results.innerHTML = `<p style="color:var(--text-dim);font-size:13.5px">התחל להקליד כדי לחפש משימות, הזמנות, שאלות, בניינים, קומות והערות.</p>`; return; }
    const r = runSearch(q);
    if (!r || !r.groups.length) { results.innerHTML = `<p style="color:var(--text-dim);font-size:13.5px">לא נמצאו תוצאות עבור "${esc(q)}"</p>`; return; }
    results.innerHTML = r.groups.map((g) => `
      <div class="search-group-title">${g.icon} ${esc(g.title)} (${g.items.length})</div>
      ${g.items.map((it, i) => `<div class="search-result" data-group="${esc(g.title)}" data-i="${i}">
        <div class="icon">${g.icon}</div>
        <div class="body">
          <div class="title">${highlight(it.title, r.terms)}</div>
          ${it.sub ? `<div class="sub">${highlight(it.sub, r.terms)}</div>` : ""}
        </div>
      </div>`).join("")}
    `).join("");
    $$(".search-result", results).forEach((el) => {
      const g = r.groups.find((x) => x.title === el.dataset.group);
      const item = g.items[parseInt(el.dataset.i)];
      el.addEventListener("click", () => item.action());
    });
  }
  input.addEventListener("input", render);
  setTimeout(() => input.focus(), 80);
  render();
}
$("#search-btn").addEventListener("click", openSearchSheet);

// ==========================================================
// Reminder engine — checks due tasks, fires notifications, tints urgent banner
// ==========================================================
function fireNotification(task) {
  const title = "⏰ תזכורת: " + task.title;
  const body = locationLabel(task) || "";
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then((reg) => {
          if (reg) reg.showNotification(title, { body, icon: "icon-192.png", tag: "task-" + task.id, vibrate: [200, 100, 200] });
          else new Notification(title, { body, icon: "icon-192.png" });
        }).catch(() => new Notification(title, { body, icon: "icon-192.png" }));
      } else {
        new Notification(title, { body, icon: "icon-192.png" });
      }
    } catch (e) { console.warn("notification failed", e); }
  }
  toast(title);
}
function checkReminders() {
  const now = Date.now();
  let changed = false;
  Store.data.tasks.forEach((t) => {
    if (t.status === "done" || t.hold || !t.dueAt || !t.reminder || !t.reminder.enabled) return;
    const last = t.reminder.lastFiredAt || 0;
    const repeatMs = t.reminder.repeatMinutes ? t.reminder.repeatMinutes * 60000 : Infinity;
    const due = now >= t.dueAt && (!t.reminder.lastFiredAt || now - last >= repeatMs);
    if (due) {
      fireNotification(t);
      t.reminder.lastFiredAt = now;
      changed = true;
    }
  });
  if (changed) Store.persist();
  updateUrgentBanner();
  if (state.view === "tasks") renderTasks();
}
function updateUrgentBanner() {
  const banner = $("#urgent-banner");
  const overdue = Store.data.tasks.filter((t) => taskUrgency(t) === "overdue");
  const soon = Store.data.tasks.filter((t) => taskUrgency(t) === "soon");
  banner.classList.remove("level-overdue", "level-soon");
  if (overdue.length) {
    banner.classList.add("show", "level-overdue");
    banner.innerHTML = `<span>🔴 ${overdue.length} תזכורות באיחור</span><span>לצפייה ›</span>`;
  } else if (soon.length) {
    banner.classList.add("show", "level-soon");
    banner.innerHTML = `<span>🟠 ${soon.length} תזכורות בקרוב</span><span>לצפייה ›</span>`;
  } else {
    banner.classList.remove("show");
  }
}
$("#urgent-banner").addEventListener("click", () => {
  switchView("tasks");
  state.taskStatusFilter = "all";
  $$("#tasks-status-filter .chip").forEach((x) => x.classList.toggle("active", x.dataset.status === "all"));
  state.tasksSort = "due"; Store.setUiPref("tasksSort", "due");
  renderTasks();
});

// ==========================================================
// Render all
// ==========================================================
function renderAll() {
  renderTasks();
  renderOrders();
  renderBuildings();
  renderQuestions();
  renderGeneralNotes();
  updateUrgentBanner();
}

// ==========================================================
// PWA: service worker + version check
// ==========================================================
$("#app-version-label").textContent = APP_VERSION;
updateNotifPermissionLabel();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      // check for update every time the app is opened
      reg.update();

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            $("#update-banner").classList.add("show");
          }
        });
      });

      $("#check-update-btn").addEventListener("click", () => {
        reg.update().then(() => toast("נבדק — האפליקציה מעודכנת"));
      });
    }).catch((err) => console.error("SW registration failed", err));

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
$("#update-btn").addEventListener("click", () => {
  navigator.serviceWorker.getRegistration().then((reg) => {
    if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  });
});

// ---------------- init ----------------
renderAll();
checkReminders();
setInterval(checkReminders, 20000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkReminders(); });
