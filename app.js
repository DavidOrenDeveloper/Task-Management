// app.js — ניווט, רינדור, וטיפול באירועים
const APP_VERSION = "1.1.0";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => (s || "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  view: "tasks",
  taskStatusFilter: "all",
  taskTypeFilter: "all",
  orderStatusFilter: "all",
  questionStatusFilter: "all",
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
// TASKS
// ==========================================================
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
  if (state.taskStatusFilter !== "all") items = items.filter((t) => t.status === state.taskStatusFilter);
  if (state.taskTypeFilter !== "all") items = items.filter((t) => t.type === state.taskTypeFilter);
  items.sort((a, b) => {
    const order = { open: 0, in_progress: 1, done: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return b.updatedAt - a.updatedAt;
  });
  $("#tasks-count").textContent = `${items.length} פריטים`;

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">✅</div><p>אין משימות להצגה.<br>לחץ על + כדי להוסיף משימה חדשה.</p></div>`;
    return;
  }

  list.innerHTML = items.map((t) => {
    const loc = locationLabel(t);
    const budget = buildingBudgetFor(t) || t.budgetCode;
    return `
    <div class="card ${t.status === "done" ? "done" : ""}" data-id="${t.id}">
      <div class="card-top">
        <div class="status-dot ${t.status}" data-action="cycle-status"></div>
        <div class="card-title ${t.status === "done" ? "strike" : ""}">${esc(t.title)}</div>
      </div>
      <div class="card-meta">
        <span class="tag type">${esc(t.type)}</span>
        ${loc ? `<span class="tag loc">📍 ${esc(loc)}</span>` : ""}
        ${t.priority === "high" ? `<span class="tag prio-high">דחוף</span>` : ""}
      </div>
      ${t.notes.length ? `<div class="card-notes">${t.notes.map((n) => `<div class="note-line"><span>${esc(n.text)}</span><button class="note-del" data-note="${n.id}">✕</button></div>`).join("")}</div>` : ""}
      ${t.budgetCode || budget ? `<button class="budget-toggle" data-action="toggle-budget">💰 סעיף תקציבי</button><div class="budget-value">קוד: <b>${esc(t.budgetCode || budget)}</b></div>` : ""}
      <div class="card-actions">
        <button data-action="add-note">📝 הוסף הערה</button>
        <button data-action="edit">✏️ ערוך</button>
        <button data-action="delete" class="danger">🗑 מחק</button>
      </div>
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
wireCardActions($("#tasks-list"), "task");

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
      <div class="select-chip-group" id="f-type-group">
        ${Store.data.taskTypes.map((t) => `<div class="select-chip ${t === task.type ? "active" : ""}" data-val="${esc(t)}">${esc(t)}</div>`).join("")}
      </div>
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
    <button class="btn-primary" id="save-task">${isEdit ? "שמירה" : "הוספת משימה"}</button>
    ${isEdit ? `<button class="btn-danger" id="delete-task">מחיקת משימה</button>` : ""}
  `;
}

function openTaskForm(taskId) {
  const task = taskId ? Store.data.tasks.find((t) => t.id === taskId) : null;
  openSheet(taskFormHTML(task));
  wireFloorSelect(task && task.buildingId, task && task.floorId);
  let selType = task ? task.type : Store.data.taskTypes[0];
  let selPriority = task ? task.priority : "normal";
  $("#f-type-group").addEventListener("click", (e) => {
    if (!e.target.classList.contains("select-chip")) return;
    $$("#f-type-group .select-chip").forEach((c) => c.classList.remove("active"));
    e.target.classList.add("active");
    selType = e.target.dataset.val;
  });
  $("#f-priority-group").addEventListener("click", (e) => {
    if (!e.target.classList.contains("select-chip")) return;
    $$("#f-priority-group .select-chip").forEach((c) => c.classList.remove("active"));
    e.target.classList.add("active");
    selPriority = e.target.dataset.val;
  });
  $("#save-task").addEventListener("click", () => {
    const title = $("#f-title").value.trim();
    if (!title) { toast("צריך להזין תיאור למשימה"); return; }
    const payload = {
      title,
      type: selType,
      priority: selPriority,
      buildingId: $("#f-building").value || null,
      floorId: $("#f-floor").value || null,
      budgetCode: $("#f-budget").value.trim(),
    };
    if (task) {
      Store.updateTask(task.id, payload);
      toast("המשימה עודכנה");
    } else {
      Store.addTask(payload);
      toast("המשימה נוספה");
    }
    closeSheet();
    renderTasks();
  });
  if (task) {
    $("#delete-task").addEventListener("click", () => {
      if (confirm("למחוק את המשימה?")) {
        Store.deleteTask(task.id);
        closeSheet();
        renderTasks();
        toast("המשימה נמחקה");
      }
    });
  }
}

function wireCardActions(container, kind) {
  container.addEventListener("click", (e) => {
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
        if (confirm("למחוק את המשימה?")) { Store.deleteTask(id); renderTasks(); toast("נמחק"); }
      }
      return;
    }
    if (e.target.dataset.action === "add-note") {
      const text = prompt("הערה חדשה:");
      if (text && text.trim()) {
        if (kind === "task") { Store.addTaskNote(id, text.trim()); renderTasks(); }
      }
      return;
    }
    if (e.target.dataset.note) {
      if (kind === "task") { Store.deleteTaskNote(id, e.target.dataset.note); renderTasks(); }
      return;
    }
    // clicking the card itself (not a button) opens edit
    if (!e.target.closest("button") && !e.target.classList.contains("status-dot")) {
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

function renderOrders() {
  const list = $("#orders-list");
  let items = [...Store.data.orders];
  if (state.orderStatusFilter !== "all") items = items.filter((o) => o.status === state.orderStatusFilter);
  items.sort((a, b) => b.createdAt - a.createdAt);
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
    <div class="card" data-id="${o.id}">
      <div class="card-top">
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
function ordersClickHandler(e) {
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
    if (confirm("למחוק את ההזמנה?")) { Store.deleteOrder(id); renderOrders(); toast("נמחק"); }
    return;
  }
  if (!e.target.closest("button")) openOrderForm(id);
}
$$("#orders-status-filter .chip").forEach((c) => c.addEventListener("click", () => {
  $$("#orders-status-filter .chip").forEach((x) => x.classList.remove("active"));
  c.classList.add("active");
  state.orderStatusFilter = c.dataset.status;
  renderOrders();
}));
$("#orders-list").addEventListener("click", ordersClickHandler);

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
        <select id="f-category">
          ${Store.data.orderCategories.map((c) => `<option value="${esc(c)}" ${c === order.category ? "selected" : ""}>${esc(c)}</option>`).join("")}
        </select>
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
function openOrderForm(orderId) {
  const order = orderId ? Store.data.orders.find((o) => o.id === orderId) : null;
  openSheet(orderFormHTML(order));
  wireFloorSelect(order && order.buildingId, order && order.floorId);
  $("#save-order").addEventListener("click", () => {
    const title = $("#f-title").value.trim();
    if (!title) { toast("צריך להזין שם פריט"); return; }
    const payload = {
      title,
      category: $("#f-category").value,
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
    $("#delete-order").addEventListener("click", () => {
      if (confirm("למחוק?")) { Store.deleteOrder(order.id); closeSheet(); renderOrders(); toast("נמחק"); }
    });
  }
}

// ==========================================================
// BUILDINGS
// ==========================================================
function renderBuildings() {
  const list = $("#buildings-list");
  const buildings = Store.data.buildings;
  $("#buildings-count").textContent = `${buildings.length} בניינים`;
  if (!buildings.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">🏢</div><p>עדיין לא נוספו בניינים.<br>הוסף בניין כדי לשייך אליו משימות והזמנות.</p></div>`;
    return;
  }
  list.innerHTML = buildings.map((b) => `
    <div class="building-block" data-id="${b.id}">
      <div class="building-head" data-action="toggle">
        <div class="name">🏢 ${esc(b.name)}</div>
        <div class="arrow">⌄</div>
      </div>
      <div class="floor-list">
        ${b.budgetCode ? `<button class="budget-toggle" data-action="toggle-budget">💰 סעיף תקציבי כללי לבניין</button><div class="budget-value">קוד: <b>${esc(b.budgetCode)}</b></div>` : ""}
        ${b.floors.map((f) => `
          <div class="floor-row">
            <span>${esc(f.name)} ${f.budgetCode ? `<span class="mono" style="color:var(--text-dim);font-size:11px">(${esc(f.budgetCode)})</span>` : ""}</span>
            <span>
              <button data-action="edit-floor" data-floor="${f.id}">✏️</button>
              <button data-action="delete-floor" data-floor="${f.id}">🗑</button>
            </span>
          </div>
        `).join("")}
        <button class="add-floor-btn" data-action="add-floor">+ הוספת קומה</button>
        <button class="btn-secondary" data-action="edit-building" style="margin-top:10px">✏️ עריכת פרטי בניין</button>
        <button class="btn-danger" data-action="delete-building">🗑 מחיקת בניין</button>
      </div>
    </div>
  `).join("");
}
function buildingsClickHandler(e) {
  const block = e.target.closest(".building-block");
  if (!block) return;
  const bid = block.dataset.id;
  const action = e.target.dataset.action;
  if (action === "toggle" || (!action && e.target.closest(".building-head"))) {
    block.classList.toggle("open");
    return;
  }
  if (action === "toggle-budget") { e.target.nextElementSibling.classList.toggle("show"); return; }
  if (action === "add-floor") {
    const name = prompt("שם הקומה (לדוגמה: קומה 3):");
    if (name && name.trim()) { Store.addFloor(bid, name.trim()); renderBuildings(); }
    return;
  }
  if (action === "edit-floor") {
    const fid = e.target.dataset.floor;
    const b = Store.data.buildings.find((x) => x.id === bid);
    const f = b.floors.find((x) => x.id === fid);
    const name = prompt("שם הקומה:", f.name);
    if (name === null) return;
    const budget = prompt("סעיף תקציבי לקומה (ריק = ללא):", f.budgetCode || "");
    Store.updateFloor(bid, fid, { name: name.trim() || f.name, budgetCode: (budget || "").trim() });
    renderBuildings();
    return;
  }
  if (action === "delete-floor") {
    if (confirm("למחוק את הקומה?")) { Store.deleteFloor(bid, e.target.dataset.floor); renderBuildings(); }
    return;
  }
  if (action === "edit-building") { openBuildingForm(bid); return; }
  if (action === "delete-building") {
    if (confirm("למחוק את הבניין? משימות/הזמנות משויכות יישארו אך יתנתקו מהבניין.")) {
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

// ==========================================================
// QUESTIONS
// ==========================================================
function renderQuestions() {
  const list = $("#questions-list");
  let items = [...Store.data.questions];
  if (state.questionStatusFilter !== "all") items = items.filter((q) => q.status === state.questionStatusFilter);
  items.sort((a, b) => b.createdAt - a.createdAt);
  $("#questions-count").textContent = `${items.length} פריטים`;
  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="big">❓</div><p>אין שאלות פתוחות.<br>כאן ריכזת שאלות/בעיות שדורשות בירור מול אחרים.</p></div>`;
    return;
  }
  list.innerHTML = items.map((q) => `
    <div class="card ${q.status === "answered" ? "done" : ""}" data-id="${q.id}">
      <div class="card-top">
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
function questionsClickHandler(e) {
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
    const ans = prompt("תשובה / סיכום:", q.answer || "");
    if (ans !== null) { Store.updateQuestion(id, { answer: ans.trim(), status: ans.trim() ? "answered" : q.status }); renderQuestions(); }
    return;
  }
  if (e.target.dataset.action === "edit") { openQuestionForm(id); return; }
  if (e.target.dataset.action === "delete") {
    if (confirm("למחוק?")) { Store.deleteQuestion(id); renderQuestions(); toast("נמחק"); }
    return;
  }
  if (!e.target.closest("button")) openQuestionForm(id);
}
$$("#questions-status-filter .chip").forEach((c) => c.addEventListener("click", () => {
  $$("#questions-status-filter .chip").forEach((x) => x.classList.remove("active"));
  c.classList.add("active");
  state.questionStatusFilter = c.dataset.status;
  renderQuestions();
}));
$("#questions-list").addEventListener("click", questionsClickHandler);
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
  const items = Store.data.generalNotes;
  if (!items.length) { list.innerHTML = `<div class="empty-state" style="padding:20px"><p>אין הערות כלליות.</p></div>`; return; }
  list.innerHTML = items.map((n) => `
    <div class="card" data-id="${n.id}" style="padding:12px">
      <div class="note-line" style="font-size:14px;color:var(--text)">
        <span>${esc(n.text)}</span>
        <button class="note-del" data-action="delete-note">✕</button>
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-top:4px">${timeAgo(n.createdAt)}</div>
    </div>
  `).join("");
  list.onclick = (e) => {
    if (e.target.dataset.action === "delete-note") {
      const id = e.target.closest(".card").dataset.id;
      Store.deleteGeneralNote(id);
      renderGeneralNotes();
    }
  };
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
      ${items.map((c) => `<div class="link-row"><span>${esc(c)}</span><button class="del" data-cat="${esc(c)}">מחק</button></div>`).join("") || `<p style="color:var(--text-dim);font-size:14px">אין פריטים עדיין</p>`}
    </div>
    <div class="inline-add">
      <input type="text" id="new-cat-input" placeholder="קטגוריה חדשה...">
      <button id="new-cat-add">הוסף</button>
    </div>
  `;
}
$("#manage-task-types").addEventListener("click", () => {
  openSheet(categoryManagerHTML("סוגי משימות", Store.data.taskTypes));
  wireCategoryManager(() => Store.data.taskTypes, (v) => Store.addTaskType(v), (v) => Store.deleteTaskType(v), "סוגי משימות");
});
$("#manage-order-categories").addEventListener("click", () => {
  openSheet(categoryManagerHTML("קטגוריות הזמנה", Store.data.orderCategories));
  wireCategoryManager(() => Store.data.orderCategories, (v) => Store.addOrderCategory(v), (v) => Store.deleteOrderCategory(v), "קטגוריות הזמנה");
});
function wireCategoryManager(getItems, addFn, delFn, title) {
  $("#new-cat-add").addEventListener("click", () => {
    const input = $("#new-cat-input");
    const val = input.value.trim();
    if (!val) return;
    addFn(val);
    openSheet(categoryManagerHTML(title, getItems()));
    wireCategoryManager(getItems, addFn, delFn, title);
  });
  $$("#cat-list .del").forEach((btn) => btn.addEventListener("click", () => {
    if (confirm(`למחוק את "${btn.dataset.cat}"?`)) {
      delFn(btn.dataset.cat);
      openSheet(categoryManagerHTML(title, getItems()));
      wireCategoryManager(getItems, addFn, delFn, title);
    }
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
  reader.onload = () => {
    try {
      if (!confirm("ייבוא הגיבוי יחליף את כל הנתונים הקיימים במכשיר זה. להמשיך?")) return;
      Store.importJSON(reader.result);
      renderAll();
      toast("הנתונים שוחזרו בהצלחה");
    } catch (err) {
      toast("קובץ לא תקין");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});
$("#wipe-data").addEventListener("click", () => {
  if (confirm("פעולה זו תמחק את כל הנתונים במכשיר לצמיתות. להמשיך?")) {
    if (confirm("בטוח לגמרי? אין אפשרות לשחזר לאחר מכן (אלא אם יש גיבוי).")) {
      Store.wipeAll();
      renderAll();
      toast("כל הנתונים נמחקו");
    }
  }
});

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
// Search (simple across tasks/orders/questions)
// ==========================================================
$("#search-btn").addEventListener("click", () => {
  const q = prompt("חיפוש בכל הרשימות:");
  if (!q || !q.trim()) return;
  const term = q.trim().toLowerCase();
  const results = [];
  Store.data.tasks.forEach((t) => { if (t.title.toLowerCase().includes(term)) results.push(`✅ ${t.title}`); });
  Store.data.orders.forEach((o) => { if (o.title.toLowerCase().includes(term)) results.push(`📦 ${o.title}`); });
  Store.data.questions.forEach((qq) => { if (qq.text.toLowerCase().includes(term)) results.push(`❓ ${qq.text}`); });
  openSheet(`<h3>תוצאות חיפוש: "${esc(q)}"</h3>${results.length ? results.map((r) => `<div class="link-row"><span>${esc(r)}</span></div>`).join("") : `<p style="color:var(--text-dim)">לא נמצאו תוצאות</p>`}`);
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
}

// ==========================================================
// PWA: service worker + version check
// ==========================================================
$("#app-version-label").textContent = APP_VERSION;

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
