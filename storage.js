// storage.js — שכבת נתונים. הכל נשמר מקומית בטלפון (localStorage).
// אין שרת, אין חיבור אינטרנט נדרש לשימוש שוטף.

const DB_KEY = "elec_site_manager_v1";
const GENERAL_CATEGORY = "כללי";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function defaultData() {
  return {
    schemaVersion: 2,
    buildings: [
      // { id, name, budgetCode, notes, order, floors: [{id, name, budgetCode, order}] }
    ],
    taskTypes: ["חשמל שטח", "משרדי", "טלפוני"],
    orderCategories: ["חומרי חשמל", "ציוד משרדי", "כלי עבודה"],
    tasks: [
      // { id, title, type, status: open/in_progress/done, buildingId, floorId,
      //   budgetCode, notes:[{id,text,createdAt}], createdAt, updatedAt, priority, order,
      //   hold:false, dueAt:null, reminder:{ enabled, snoozeMinutes, repeatMinutes, lastFiredAt } }
    ],
    orders: [
      // { id, title, category, qty, buildingId, budgetCode, status: pending/ordered/arrived/installed,
      //   notes, createdAt, order }
    ],
    questions: [
      // { id, text, relatedTo, status: open/answered, answer, createdAt, order }
    ],
    generalNotes: [
      // { id, text, createdAt, order }
    ],
    locationNotes: [
      // { id, buildingId, floorId (null = building-level note), text, createdAt, order }
    ],
    uiPrefs: {
      // per-list sort mode, persisted across sessions
      tasksSort: "default",
      ordersSort: "default",
      questionsSort: "default",
      buildingsSort: "default",
    },
  };
}

function withOrder(arr) {
  arr.forEach((x, i) => { if (typeof x.order !== "number") x.order = i; });
  return arr;
}

function migrate(data) {
  const d = Object.assign(defaultData(), data || {});
  d.uiPrefs = Object.assign(defaultData().uiPrefs, d.uiPrefs || {});
  if (!Array.isArray(d.locationNotes)) d.locationNotes = [];

  // schemaVersion 1 -> 2: add order fields, reminder/hold fields to tasks, floor order
  withOrder(d.buildings);
  d.buildings.forEach((b) => {
    if (!Array.isArray(b.floors)) b.floors = [];
    withOrder(b.floors);
    if (typeof b.notes !== "string") b.notes = b.notes || "";
  });
  withOrder(d.tasks);
  d.tasks.forEach((t) => {
    if (typeof t.hold !== "boolean") t.hold = false;
    if (typeof t.dueAt === "undefined") t.dueAt = null;
    if (!t.reminder) t.reminder = null;
    if (!Array.isArray(t.notes)) t.notes = [];
  });
  withOrder(d.orders);
  withOrder(d.questions);
  withOrder(d.generalNotes);
  withOrder(d.locationNotes);

  d.schemaVersion = 2;
  return d;
}

function load() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return defaultData();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error("Failed to load data, starting fresh", e);
    return defaultData();
  }
}

function save(data) {
  localStorage.setItem(DB_KEY, JSON.stringify(data));
}

function nextOrder(arr) {
  return arr.reduce((max, x) => Math.max(max, typeof x.order === "number" ? x.order : 0), -1) + 1;
}

const Store = {
  data: load(),

  persist() {
    save(this.data);
  },

  // ---------- Generic reorder ----------
  // orderedIds: array of ids in the new desired order
  reorderList(arr, orderedIds) {
    orderedIds.forEach((id, i) => {
      const item = arr.find((x) => x.id === id);
      if (item) item.order = i;
    });
    this.persist();
  },
  reorderTasks(ids) { this.reorderList(this.data.tasks, ids); },
  reorderOrders(ids) { this.reorderList(this.data.orders, ids); },
  reorderQuestions(ids) { this.reorderList(this.data.questions, ids); },
  reorderGeneralNotes(ids) { this.reorderList(this.data.generalNotes, ids); },
  reorderBuildings(ids) { this.reorderList(this.data.buildings, ids); },
  reorderFloors(buildingId, ids) {
    const b = this.data.buildings.find((x) => x.id === buildingId);
    if (!b) return;
    this.reorderList(b.floors, ids);
  },
  reorderLocationNotes(buildingId, floorId, ids) {
    const scoped = this.getLocationNotes(buildingId, floorId);
    ids.forEach((id, i) => {
      const item = scoped.find((x) => x.id === id);
      if (item) item.order = i;
    });
    this.persist();
  },

  // ---------- Buildings ----------
  addBuilding(name, budgetCode = "") {
    const b = { id: uid(), name, budgetCode, notes: "", floors: [], order: nextOrder(this.data.buildings) };
    this.data.buildings.push(b);
    this.persist();
    return b;
  },
  updateBuilding(id, patch) {
    const b = this.data.buildings.find((x) => x.id === id);
    if (b) Object.assign(b, patch);
    this.persist();
  },
  deleteBuilding(id) {
    this.data.buildings = this.data.buildings.filter((x) => x.id !== id);
    // detach references rather than deleting the tasks/orders themselves
    [...this.data.tasks, ...this.data.orders].forEach((item) => {
      if (item.buildingId === id) {
        item.buildingId = null;
        item.floorId = null;
      }
    });
    this.data.locationNotes = this.data.locationNotes.filter((n) => n.buildingId !== id);
    this.persist();
  },
  addFloor(buildingId, name, budgetCode = "") {
    const b = this.data.buildings.find((x) => x.id === buildingId);
    if (!b) return null;
    const f = { id: uid(), name, budgetCode, order: nextOrder(b.floors) };
    b.floors.push(f);
    this.persist();
    return f;
  },
  updateFloor(buildingId, floorId, patch) {
    const b = this.data.buildings.find((x) => x.id === buildingId);
    if (!b) return;
    const f = b.floors.find((x) => x.id === floorId);
    if (f) Object.assign(f, patch);
    this.persist();
  },
  deleteFloor(buildingId, floorId) {
    const b = this.data.buildings.find((x) => x.id === buildingId);
    if (!b) return;
    b.floors = b.floors.filter((x) => x.id !== floorId);
    [...this.data.tasks, ...this.data.orders].forEach((item) => {
      if (item.floorId === floorId) item.floorId = null;
    });
    this.data.locationNotes = this.data.locationNotes.filter((n) => n.floorId !== floorId);
    this.persist();
  },

  // ---------- Location notes (per building / per floor) ----------
  getLocationNotes(buildingId, floorId) {
    return this.data.locationNotes
      .filter((n) => n.buildingId === buildingId && (n.floorId || null) === (floorId || null))
      .sort((a, b) => a.order - b.order);
  },
  addLocationNote(buildingId, floorId, text) {
    const scoped = this.getLocationNotes(buildingId, floorId);
    const n = { id: uid(), buildingId, floorId: floorId || null, text, createdAt: Date.now(), order: nextOrder(scoped) };
    this.data.locationNotes.push(n);
    this.persist();
    return n;
  },
  updateLocationNote(id, patch) {
    const n = this.data.locationNotes.find((x) => x.id === id);
    if (n) Object.assign(n, patch);
    this.persist();
  },
  deleteLocationNote(id) {
    this.data.locationNotes = this.data.locationNotes.filter((x) => x.id !== id);
    this.persist();
  },
  itemsForLocation(buildingId, floorId) {
    const matchLoc = (item) => item.buildingId === buildingId && (item.floorId || null) === (floorId || null);
    return {
      tasks: this.data.tasks.filter(matchLoc),
      orders: this.data.orders.filter(matchLoc),
      questions: [], // questions aren't location-linked in this schema
      notes: this.getLocationNotes(buildingId, floorId),
    };
  },

  // ---------- Categories ----------
  // Returns items currently using a task type / order category
  usageOfTaskType(name) {
    return this.data.tasks.filter((t) => t.type === name);
  },
  usageOfOrderCategory(name) {
    return this.data.orders.filter((o) => o.category === name);
  },
  addTaskType(name) {
    if (!this.data.taskTypes.includes(name)) this.data.taskTypes.push(name);
    this.persist();
  },
  // mode: "reassign" (move affected tasks to GENERAL_CATEGORY, creating it if needed) or "delete" (remove affected tasks too)
  deleteTaskType(name, mode = "reassign") {
    if (mode === "delete") {
      this.data.tasks = this.data.tasks.filter((t) => t.type !== name);
    } else {
      if (name !== GENERAL_CATEGORY && !this.data.taskTypes.includes(GENERAL_CATEGORY)) {
        this.data.taskTypes.push(GENERAL_CATEGORY);
      }
      this.data.tasks.forEach((t) => { if (t.type === name) t.type = GENERAL_CATEGORY; });
    }
    this.data.taskTypes = this.data.taskTypes.filter((t) => t !== name);
    this.persist();
  },
  addOrderCategory(name) {
    if (!this.data.orderCategories.includes(name)) this.data.orderCategories.push(name);
    this.persist();
  },
  deleteOrderCategory(name, mode = "reassign") {
    if (mode === "delete") {
      this.data.orders = this.data.orders.filter((o) => o.category !== name);
    } else {
      if (name !== GENERAL_CATEGORY && !this.data.orderCategories.includes(GENERAL_CATEGORY)) {
        this.data.orderCategories.push(GENERAL_CATEGORY);
      }
      this.data.orders.forEach((o) => { if (o.category === name) o.category = GENERAL_CATEGORY; });
    }
    this.data.orderCategories = this.data.orderCategories.filter((t) => t !== name);
    this.persist();
  },

  // ---------- Tasks ----------
  addTask(task) {
    const t = {
      id: uid(),
      title: "",
      type: this.data.taskTypes[0] || "",
      status: "open",
      buildingId: null,
      floorId: null,
      budgetCode: "",
      priority: "normal",
      notes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: nextOrder(this.data.tasks),
      hold: false,
      dueAt: null,
      reminder: null,
      ...task,
    };
    this.data.tasks.unshift(t);
    this.persist();
    return t;
  },
  updateTask(id, patch) {
    const t = this.data.tasks.find((x) => x.id === id);
    if (t) {
      Object.assign(t, patch, { updatedAt: Date.now() });
    }
    this.persist();
    return t;
  },
  deleteTask(id) {
    this.data.tasks = this.data.tasks.filter((x) => x.id !== id);
    this.persist();
  },
  addTaskNote(taskId, text) {
    const t = this.data.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.notes.push({ id: uid(), text, createdAt: Date.now() });
    t.updatedAt = Date.now();
    this.persist();
  },
  deleteTaskNote(taskId, noteId) {
    const t = this.data.tasks.find((x) => x.id === taskId);
    if (!t) return;
    t.notes = t.notes.filter((n) => n.id !== noteId);
    this.persist();
  },

  // ---------- Reminders ----------
  // snoozeMinutes: postpone the next fire by N minutes from now
  snoozeTask(id, minutes) {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) return;
    t.dueAt = Date.now() + minutes * 60000;
    t.hold = false;
    if (!t.reminder) t.reminder = { enabled: true, repeatMinutes: null, lastFiredAt: null };
    t.reminder.enabled = true;
    t.reminder.lastFiredAt = null;
    this.persist();
  },
  setTaskHold(id, hold) {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) return;
    t.hold = hold;
    this.persist();
  },
  completeTask(id) {
    const t = this.data.tasks.find((x) => x.id === id);
    if (!t) return;
    t.status = "done";
    t.hold = false;
    if (t.reminder) t.reminder.enabled = false;
    t.updatedAt = Date.now();
    this.persist();
  },

  // ---------- Orders ----------
  addOrder(order) {
    const o = {
      id: uid(),
      title: "",
      category: this.data.orderCategories[0] || "",
      qty: 1,
      buildingId: null,
      floorId: null,
      budgetCode: "",
      status: "pending", // pending -> ordered -> arrived -> installed
      notes: "",
      createdAt: Date.now(),
      order: nextOrder(this.data.orders),
      ...order,
    };
    this.data.orders.unshift(o);
    this.persist();
    return o;
  },
  updateOrder(id, patch) {
    const o = this.data.orders.find((x) => x.id === id);
    if (o) Object.assign(o, patch);
    this.persist();
  },
  deleteOrder(id) {
    this.data.orders = this.data.orders.filter((x) => x.id !== id);
    this.persist();
  },

  // ---------- Questions ----------
  addQuestion(q) {
    const question = {
      id: uid(),
      text: "",
      relatedTo: "",
      status: "open",
      answer: "",
      createdAt: Date.now(),
      order: nextOrder(this.data.questions),
      ...q,
    };
    this.data.questions.unshift(question);
    this.persist();
    return question;
  },
  updateQuestion(id, patch) {
    const q = this.data.questions.find((x) => x.id === id);
    if (q) Object.assign(q, patch);
    this.persist();
  },
  deleteQuestion(id) {
    this.data.questions = this.data.questions.filter((x) => x.id !== id);
    this.persist();
  },

  // ---------- General notes ----------
  addGeneralNote(text) {
    const n = { id: uid(), text, createdAt: Date.now(), order: nextOrder(this.data.generalNotes) };
    this.data.generalNotes.unshift(n);
    this.persist();
    return n;
  },
  deleteGeneralNote(id) {
    this.data.generalNotes = this.data.generalNotes.filter((x) => x.id !== id);
    this.persist();
  },

  // ---------- UI prefs (sort modes etc, persisted) ----------
  setUiPref(key, value) {
    this.data.uiPrefs[key] = value;
    this.persist();
  },

  // ---------- Backup / restore (manual multi-device sync) ----------
  exportJSON() {
    return JSON.stringify(this.data, null, 2);
  },
  importJSON(json) {
    const parsed = JSON.parse(json);
    this.data = migrate(parsed);
    this.persist();
  },
  wipeAll() {
    this.data = defaultData();
    this.persist();
  },
};

window.Store = Store;
window.GENERAL_CATEGORY = GENERAL_CATEGORY;
