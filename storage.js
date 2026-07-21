// storage.js — שכבת נתונים. הכל נשמר מקומית בטלפון (localStorage).
// אין שרת, אין חיבור אינטרנט נדרש לשימוש שוטף.

const DB_KEY = "elec_site_manager_v1";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function defaultData() {
  return {
    schemaVersion: 1,
    buildings: [
      // { id, name, budgetCode, notes, floors: [{id, name, budgetCode}] }
    ],
    taskTypes: ["חשמל שטח", "משרדי", "טלפוני"],
    orderCategories: ["חומרי חשמל", "ציוד משרדי", "כלי עבודה"],
    tasks: [
      // { id, title, type, status: open/in_progress/done, buildingId, floorId,
      //   budgetCode, notes:[{id,text,createdAt}], createdAt, updatedAt, priority }
    ],
    orders: [
      // { id, title, category, qty, buildingId, budgetCode, status: pending/ordered/arrived/installed,
      //   notes, createdAt }
    ],
    questions: [
      // { id, text, relatedTo, status: open/answered, answer, createdAt }
    ],
    generalNotes: [
      // { id, text, createdAt }
    ],
  };
}

function migrate(data) {
  const d = Object.assign(defaultData(), data || {});
  // future migrations go here based on schemaVersion
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

const Store = {
  data: load(),

  persist() {
    save(this.data);
  },

  // ---------- Buildings ----------
  addBuilding(name, budgetCode = "") {
    const b = { id: uid(), name, budgetCode, notes: "", floors: [] };
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
    this.persist();
  },
  addFloor(buildingId, name, budgetCode = "") {
    const b = this.data.buildings.find((x) => x.id === buildingId);
    if (!b) return null;
    const f = { id: uid(), name, budgetCode };
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
    this.persist();
  },

  // ---------- Categories ----------
  addTaskType(name) {
    if (!this.data.taskTypes.includes(name)) this.data.taskTypes.push(name);
    this.persist();
  },
  deleteTaskType(name) {
    this.data.taskTypes = this.data.taskTypes.filter((t) => t !== name);
    this.persist();
  },
  addOrderCategory(name) {
    if (!this.data.orderCategories.includes(name)) this.data.orderCategories.push(name);
    this.persist();
  },
  deleteOrderCategory(name) {
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
    const n = { id: uid(), text, createdAt: Date.now() };
    this.data.generalNotes.unshift(n);
    this.persist();
    return n;
  },
  deleteGeneralNote(id) {
    this.data.generalNotes = this.data.generalNotes.filter((x) => x.id !== id);
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
