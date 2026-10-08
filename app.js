// app.js — ניווט, רינדור, וטיפול באירועים
const APP_VERSION = "2.4.0";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => (s || "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ==========================================================
// Rich text editor (real inline formatting: bold / italic / lists / alignment / colors)
// Formatting is applied live to the text itself via contenteditable + execCommand,
// the same way a normal word processor does — no separate markdown+preview needed.
// Saved content is sanitized HTML (see sanitizeHtml). Older notes that were saved as
// plain/markdown text (from a previous version of the app) still render correctly via
// the legacy formatNoteText() fallback inside renderRichText().
// ==========================================================
const RICH_ALLOWED_TAGS = new Set(["B", "STRONG", "I", "EM", "UL", "OL", "LI", "BR", "DIV", "SPAN", "P"]);
function sanitizeRichAttrs(el) {
  const style = el.getAttribute("style");
  [...el.attributes].forEach((a) => el.removeAttribute(a.name));
  if (!style) return;
  const kept = [];
  style.split(";").forEach((decl) => {
    const idx = decl.indexOf(":");
    if (idx === -1) return;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!val) return;
    if (prop === "color" || prop === "background-color") {
      if (/^(#[0-9a-f]{3,8}|rgb\([\d,\s]+\)|rgba\([\d,.\s]+\)|[a-z]+)$/i.test(val)) kept.push(`${prop}:${val}`);
    } else if (prop === "text-align") {
      if (/^(left|right|center|justify)$/i.test(val)) kept.push(`${prop}:${val}`);
    } else if (prop === "font-weight") {
      if (/^(bold|normal|\d+)$/i.test(val)) kept.push(`${prop}:${val}`);
    } else if (prop === "font-style") {
      if (/^(italic|normal)$/i.test(val)) kept.push(`${prop}:${val}`);
    }
  });
  if (kept.length) el.setAttribute("style", kept.join(";"));
}
function cleanRichNode(node) {
  let child = node.firstChild;
  while (child) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      if (!RICH_ALLOWED_TAGS.has(child.tagName)) {
        const next = child.nextSibling;
        const firstMoved = child.firstChild;
        while (child.firstChild) node.insertBefore(child.firstChild, child);
        node.removeChild(child);
        child = firstMoved || next;
        continue;
      }
      sanitizeRichAttrs(child);
      cleanRichNode(child);
      child = child.nextSibling;
      continue;
    } else if (child.nodeType === Node.TEXT_NODE) {
      child = child.nextSibling;
      continue;
    } else {
      const next = child.nextSibling;
      node.removeChild(child);
      child = next;
      continue;
    }
  }
}
function sanitizeHtml(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  cleanRichNode(tpl.content);
  return tpl.innerHTML;
}
function looksLikeHtml(s) { return /<\/?[a-z][\s\S]*>/i.test(s || ""); }
// Renders a saved field for read-only display: sanitized HTML if it's rich content
// (new format), or runs it through the legacy markdown-ish formatter for old plain-text notes.
function renderRichText(raw) {
  if (!raw) return "";
  return looksLikeHtml(raw) ? sanitizeHtml(raw) : formatNoteText(raw);
}
// Plain-text version of a saved field, for search matching / previews (strips tags & markdown).
function stripRichText(raw) {
  if (!raw) return "";
  const div = document.createElement("div");
  div.innerHTML = looksLikeHtml(raw) ? sanitizeHtml(raw) : raw;
  return (div.textContent || "").replace(/\s+/g, " ").trim();
}
function richEditorHTML(id, placeholder, html) {
  return `
    <div class="rich-toolbar" data-target="${id}">
      <button type="button" data-fmt="undo" title="ביטול פעולה (חזרה אחורה)">↺</button>
      <button type="button" data-fmt="redo" title="ביצוע שוב (חזרה קדימה)">↻</button>
      <span class="rich-sep"></span>
      <button type="button" data-fmt="bold" title="הדגשה"><b>B</b></button>
      <button type="button" data-fmt="italic" title="נטוי"><i>I</i></button>
      <span class="rich-sep"></span>
      <button type="button" data-fmt="bullet" title="רשימת נקודות">☰</button>
      <button type="button" data-fmt="number" title="רשימה ממוספרת">1.</button>
      <span class="rich-sep"></span>
      <button type="button" data-fmt="alignRight" title="יישור לימין">➡</button>
      <button type="button" data-fmt="alignCenter" title="יישור למרכז">↔</button>
      <button type="button" data-fmt="alignLeft" title="יישור לשמאל">⬅</button>
      <span class="rich-sep"></span>
      <label class="rich-color-btn" title="צבע טקסט">A<input type="color" data-fmt="color" value="#f5b700"></label>
      <label class="rich-color-btn rich-color-bg" title="צבע רקע">A<input type="color" data-fmt="bgcolor" value="#fff3b0"></label>
      <button type="button" data-fmt="clear" title="ניקוי עיצוב">⟲</button>
    </div>
    <div id="${id}" class="rich-editor" contenteditable="true" data-placeholder="${esc(placeholder || "")}">${html || ""}</div>
  `;
}
function getRichValue(id) {
  const el = document.getElementById(id);
  if (!el) return "";
  const html = el.innerHTML.trim();
  if (!html || /^(<br\s*\/?>|&nbsp;|\s)*$/i.test(html)) return "";
  return sanitizeHtml(html);
}
let richStyleWithCSSReady = false;
function ensureRichStyleWithCSS() {
  if (richStyleWithCSSReady) return;
  try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
  richStyleWithCSSReady = true;
}
const RICH_TOOLBAR_COMMANDS = {
  bold: "bold", italic: "italic",
  bullet: "insertUnorderedList", number: "insertOrderedList",
  alignRight: "justifyRight", alignCenter: "justifyCenter", alignLeft: "justifyLeft",
};

// ==========================================================
// Undo/redo history for rich-editors — real Ctrl+Z/Ctrl+Y behavior, but as visible
// buttons, since a phone keyboard has no Ctrl key. Typing a word and tapping ↺ removes
// it, tapping ↻ brings it back — same for formatting, bullet lists, etc. Each editor
// element gets its own independent history (keyed by the live DOM element, so a fresh
// sheet/form always starts with a clean history).
// ==========================================================
const richHistory = new WeakMap();
function richHistoryEnsure(el) {
  let h = richHistory.get(el);
  if (!h) { h = { stack: [el.innerHTML], idx: 0 }; richHistory.set(el, h); }
  return h;
}
function richHistoryPush(el) {
  const h = richHistoryEnsure(el);
  const html = el.innerHTML;
  if (h.stack[h.idx] === html) return;
  h.stack = h.stack.slice(0, h.idx + 1);
  h.stack.push(html);
  if (h.stack.length > 80) h.stack.shift();
  h.idx = h.stack.length - 1;
}
function placeCaretAtEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}
function richUndo(el) {
  const h = richHistoryEnsure(el);
  if (h.idx <= 0) return;
  h.idx--;
  el.innerHTML = h.stack[h.idx];
  placeCaretAtEnd(el);
}
function richRedo(el) {
  const h = richHistoryEnsure(el);
  if (h.idx >= h.stack.length - 1) return;
  h.idx++;
  el.innerHTML = h.stack[h.idx];
  placeCaretAtEnd(el);
}

// Prevent toolbar buttons from stealing focus/selection away from the editor before we
// run execCommand — otherwise the selection collapses and formatting has nothing to apply to.
document.addEventListener("mousedown", (e) => {
  if (e.target.closest(".rich-toolbar button[data-fmt]")) e.preventDefault();
});
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".rich-toolbar button[data-fmt]");
  if (!btn) return;
  const toolbar = btn.closest(".rich-toolbar");
  const el = document.getElementById(toolbar.dataset.target);
  if (!el) return;
  const fmt = btn.dataset.fmt;
  if (fmt === "undo") { richUndo(el); return; }
  if (fmt === "redo") { richRedo(el); return; }
  el.focus();
  ensureRichStyleWithCSS();
  richHistoryEnsure(el);
  if (RICH_TOOLBAR_COMMANDS[fmt]) document.execCommand(RICH_TOOLBAR_COMMANDS[fmt], false, null);
  else if (fmt === "clear") document.execCommand("removeFormat", false, null);
  richHistoryPush(el);
});
document.addEventListener("input", (e) => {
  const input = e.target;
  if (input.matches && input.matches('.rich-toolbar input[type="color"]')) {
    const toolbar = input.closest(".rich-toolbar");
    const el = document.getElementById(toolbar.dataset.target);
    if (!el) return;
    el.focus();
    ensureRichStyleWithCSS();
    document.execCommand(input.dataset.fmt === "color" ? "foreColor" : "hiliteColor", false, input.value);
    richHistoryPush(el);
  }
});
// Plain typing: push a history snapshot a short moment after the user pauses, so every
// undo step corresponds to a natural chunk of typing rather than every single keystroke.
document.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains("rich-editor")) return;
  richHistoryEnsure(el);
  clearTimeout(el._historyTimer);
  el._historyTimer = setTimeout(() => richHistoryPush(el), 400);
});
// Desktop bonus: real Ctrl+Z / Ctrl+Y (or Cmd+Z / Cmd+Shift+Z on Mac) also work while
// focused inside a rich-editor, on top of the ↺ / ↻ buttons.
document.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains("rich-editor")) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === "z" && !e.shiftKey) { e.preventDefault(); richUndo(el); }
  else if ((e.ctrlKey || e.metaKey) && (key === "y" || (key === "z" && e.shiftKey))) { e.preventDefault(); richRedo(el); }
});

// ---------------- Legacy plain-text/markdown renderer (kept only for notes saved by an
// older version of the app, before the rich text editor above existed) ----------------
function formatNoteInline(t) {
  return t.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
}
function formatNoteText(raw) {
  const lines = esc(raw).split("\n");
  let html = "", i = 0;
  while (i < lines.length) {
    if (/^- /.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) { items.push(lines[i].slice(2)); i++; }
      html += `<ul style="margin:4px 0;padding-inline-start:20px">${items.map((t) => `<li>${formatNoteInline(t)}</li>`).join("")}</ul>`;
    } else if (/^\d+\.\s/.test(lines[i])) {
      const items = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s/, "")); i++; }
      html += `<ol style="margin:4px 0;padding-inline-start:20px">${items.map((t) => `<li>${formatNoteInline(t)}</li>`).join("")}</ol>`;
    } else {
      html += lines[i] ? `<div>${formatNoteInline(lines[i])}</div>` : "<div>&nbsp;</div>";
      i++;
    }
  }
  return html;
}

// ==========================================================
// Back-button integration (Android hardware/gesture back)
// Without this, pressing the phone's back button/triangle while a sheet or an
// expanded building is open exits the whole app instead of just closing that one thing.
// We push a history entry whenever something like that opens, and closing it (whether
// by tapping outside, an X button, or the hardware back button) pops that entry.
// ==========================================================
const backStack = [];
let suppressPopstate = false;
function pushBackable(closeFn) {
  history.pushState({ appLayer: backStack.length + 1 }, "");
  backStack.push(closeFn);
}
function popBackableIfMatches(closeFn) {
  const idx = backStack.lastIndexOf(closeFn);
  if (idx === -1) return;
  backStack.splice(idx, 1);
  if (!suppressPopstate) history.back();
}
window.addEventListener("popstate", () => {
  if (backStack.length) {
    suppressPopstate = true;
    const fn = backStack.pop();
    fn();
    suppressPopstate = false;
  }
});

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
  generalNotesSort: Store.data.uiPrefs.generalNotesSort || "manual",
  tasksUrgencyDir: Store.data.uiPrefs.tasksUrgencyDir || "asc",
  generalNotesUrgencyDir: Store.data.uiPrefs.generalNotesUrgencyDir || "asc",
  locNotesSort: "manual",
  locNotesUrgencyDir: Store.data.uiPrefs.locNotesUrgencyDir || "asc",
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
  popBackableIfMatches(closeDialogBack);
  if (dialogResolve) { const r = dialogResolve; dialogResolve = null; r(result); }
}
function closeDialogBack() { closeDialog(null); }
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
    pushBackable(closeDialogBack);
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
  const alreadyOpen = $("#sheet").classList.contains("show");
  $("#sheet-content").innerHTML = html;
  $("#sheet").classList.add("show");
  $("#sheet-backdrop").classList.add("show");
  // The sheet element is reused between opens — without this, a sheet that was
  // scrolled down last time (e.g. to reach "שמירה" at the bottom of a long form)
  // stays scrolled down the next time it opens too, hiding the text box at the top
  // and forcing an extra scroll before the user can even start typing.
  $("#sheet").scrollTop = 0;
  if (!alreadyOpen) pushBackable(closeSheet);
}
function closeSheet() {
  $("#sheet").classList.remove("show");
  $("#sheet-backdrop").classList.remove("show");
  popBackableIfMatches(closeSheet);
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
  menu.style.left = "auto";
  menu.style.right = `${Math.max(10, window.innerWidth - rect.right)}px`;
  $$(".opt", menu).forEach((opt) => opt.addEventListener("click", () => {
    onSelect(opt.dataset.val);
    closeSortMenu();
  }));
  menu.classList.add("show");
  $("#sort-menu-backdrop").classList.add("show");
  // The menu's width depends on its (translated) content, and the sort button can sit
  // anywhere on screen — so only after layout do we know if it overflows the left edge.
  requestAnimationFrame(() => {
    const menuRect = menu.getBoundingClientRect();
    if (menuRect.left < 10) {
      menu.style.right = "auto";
      menu.style.left = "10px";
    }
  });
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
  let activePointerId = null;
  let scrollLockPrev = null;

  // Only direct children count as "this container's" reorderable items. Some lists
  // (e.g. buildings, which contain floors, which are themselves reorderable) nest one
  // reorder-enabled list inside another; without this guard, a container's query would
  // also pick up its descendants' items and the two independent drag instances would
  // fight over the same element.
  function getItems() { return $$(itemSelector, container).filter((el) => el.parentElement === container); }

  function cancelPress() { clearTimeout(pressTimer); pressTimer = null; }

  function lockPageScroll() {
    if (scrollLockPrev !== null) return;
    scrollLockPrev = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
  }
  function unlockPageScroll() {
    if (scrollLockPrev === null) return;
    document.documentElement.style.overflow = scrollLockPrev.html;
    document.body.style.overflow = scrollLockPrev.body;
    scrollLockPrev = null;
  }

  function startDrag(el) {
    dragEl = el;
    dragEl.classList.add("dragging");
    container.classList.add("reorder-active");
    lockPageScroll();
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }

  function finishDrag() {
    dragEl.classList.remove("dragging");
    container.classList.remove("reorder-active");
    unlockPageScroll();
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
    // Must be a direct child of *this* container — otherwise this press belongs to a
    // nested reorder list (e.g. a floor row inside a building), and that inner list's
    // own listener will handle it instead.
    if (!item || item.parentElement !== container) return;
    if (!e.target.closest(".drag-handle")) return;
    moved = false;
    startX = e.clientX; startY = e.clientY;
    activePointerId = e.pointerId;
    try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
    cancelPress();
    pressTimer = setTimeout(() => { if (!moved) startDrag(item); }, 420);
  });

  // pointermove/pointerup/pointercancel are attached to `document`, not `container`.
  // Moving dragEl with insertBefore() briefly detaches-and-reattaches it, which some
  // browsers treat as "removed from the DOM" and silently release pointer capture as a
  // result. Once capture is lost the pointerup can land on whatever element happens to be
  // under the finger at that instant — often outside `container` entirely (e.g. past the
  // last item, into the padding below the list) — so a container-scoped listener simply
  // never sees it, leaving the drag stuck mid-air and the new order never saved. Listening
  // on `document` guarantees this instance's own pointerup always arrives, filtered by
  // activePointerId so unrelated pointers/instances are ignored.
  document.addEventListener("pointermove", (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
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

  function onUp(e) {
    if (activePointerId !== null && e && e.pointerId !== undefined && e.pointerId !== activePointerId) return;
    cancelPress();
    if (dragEl) finishDrag();
    moved = false;
    activePointerId = null;
  }
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
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
  { value: "created_desc", label: "תאריך יצירה (חדש→ישן)" },
  { value: "created_asc", label: "תאריך יצירה (ישן→חדש)" },
  { value: "updated", label: "עודכן לאחרונה" },
  { value: "alpha", label: "לפי א-ב" },
  { value: "priority", label: "דחיפות (רגיל/דחוף)" },
  { value: "urgencyNum", label: "לפי מספר דחיפות" },
  { value: "due", label: "מועד תזכורת" },
  { value: "manual", label: "סדר ידני (גרירה)" },
];

// ---------------- Numeric urgency ranking (shared by tasks + notes) ----------------
// Lower number = more urgent (1 is most urgent). Items without a number always sort last.
// Clicking the same "urgency number" sort option again flips the direction — this is handled
// by each screen's own onSelect callback (see wireUrgencySortOption below), not here.
function urgencyVal(item) {
  const v = item && item.urgency;
  return (v === null || v === undefined || v === "") ? null : Number(v);
}
function compareUrgency(a, b, dir) {
  const av = urgencyVal(a), bv = urgencyVal(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return dir === "asc" ? av - bv : bv - av;
}
// Cyclical color coding by urgency number (1=red, 2=orange, 3=amber, 4=blue, 5=green,
// 6=purple, then repeats). Lets the eye tell urgency levels apart at a glance in a list,
// without reading the number itself. Can be switched off in settings ("תצוגה").
function urgencyColorClass(item) {
  if (Store.data.uiPrefs.urgencyColorsEnabled === false) return "";
  const v = urgencyVal(item);
  if (v === null || v < 1) return "";
  return "urgency-color-" + (((v - 1) % 6) + 1);
}
function urgencyBadgeHTML(item) {
  const v = urgencyVal(item);
  if (v === null) return "";
  const colorClass = urgencyColorClass(item);
  return `<span class="tag urgency-num ${colorClass}">🔢 ${esc(String(v))}</span>`;
}
function urgencyFieldHTML(id, value) {
  return `
    <div class="field">
      <label>מספר דחיפות (אופציונלי — ככל שקטן יותר, דחוף יותר: 1 = הכי דחוף)</label>
      <input type="number" id="${id}" value="${value === null || value === undefined ? "" : esc(String(value))}" placeholder="לדוגמה: 1" min="1" step="1" style="max-width:120px">
    </div>
  `;
}
function readUrgencyField(id) {
  const raw = ($(`#${id}`) && $(`#${id}`).value || "").trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}
// Wires a "sort by urgency number" menu option so a second click on the same option
// flips direction (asc <-> desc), matching how every other repeat-click-to-reverse
// sort in the app behaves.
function urgencySortLabel(dir) { return `לפי מספר דחיפות ${dir === "asc" ? "(1 קודם ⬆)" : "(הגבוה קודם ⬇)"}`; }

function sortItems(items, mode, kind) {
  const arr = [...items];
  if (mode === "manual") { arr.sort((a, b) => a.order - b.order); return arr; }
  if (mode === "created" || mode === "created_desc") { arr.sort((a, b) => b.createdAt - a.createdAt); return arr; }
  if (mode === "created_asc") { arr.sort((a, b) => a.createdAt - b.createdAt); return arr; }
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
  } else if (state.tasksSort === "urgencyNum") {
    items.sort((a, b) => compareUrgency(a, b, state.tasksUrgencyDir));
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
    <div class="card ${t.status === "done" ? "done" : ""} ${urgency ? "urgency-" + urgency : ""} ${urgencyColorClass(t)}" data-id="${t.id}" data-reorder-item>
      <div class="card-top">
        <span class="drag-handle">⠿</span>
        <div class="status-dot ${t.status}" data-action="cycle-status"></div>
        <div class="card-title rich-content ${t.status === "done" ? "strike" : ""}">${renderRichText(t.title)}</div>
      </div>
      <div class="card-meta">
        <span class="tag type">${esc(t.type)}</span>
        ${loc ? `<span class="tag loc">📍 ${esc(loc)}</span>` : ""}
        ${t.priority === "high" ? `<span class="tag prio-high">דחוף</span>` : ""}
        ${urgencyBadgeHTML(t)}
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
  // The date-order toggle used to be its own dedicated button; now it just lives as two
  // entries ("חדש→ישן" / "ישן→חדש") inside this same sort menu, like every other sort mode.
  const options = TASKS_SORT_OPTIONS.map((o) => o.value === "urgencyNum" ? { ...o, label: urgencySortLabel(state.tasksUrgencyDir) } : o);
  openSortMenu(e.currentTarget, state.tasksSort, options, (val) => {
    if (val === "urgencyNum") {
      state.tasksUrgencyDir = (state.tasksSort === "urgencyNum" && state.tasksUrgencyDir === "asc") ? "desc" : "asc";
      Store.setUiPref("tasksUrgencyDir", state.tasksUrgencyDir);
    }
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
  task = task || { title: "", type: Store.data.taskTypes[0] || "", priority: "normal", buildingId: "", floorId: "", budgetCode: "", urgency: null };
  return `
    <h3>${isEdit ? "עריכת משימה" : "משימה חדשה"}</h3>
    <div class="field">
      <label>תיאור המשימה</label>
      ${richEditorHTML("f-title", "לדוגמה: להתקין לוח חשמל בקומה 3", task.title)}
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
    ${urgencyFieldHTML("f-urgency", task.urgency)}
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
    const title = getRichValue("f-title");
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
      urgency: readUrgencyField("f-urgency"),
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
async function subscribeToPush(silent = false) {
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
    // Re-saving even an already-existing subscription is cheap and harmless (setDoc just
    // overwrites) — it's a safety net in case the Firestore copy was ever lost/out of sync
    // with what the browser actually holds, which is the main way "reminders stopped
    // working when the app is closed" silently happens over time.
    await window.CloudSync.saveSubscription(sub);
    if (!silent) toast("תזכורות בענן חוברו למכשיר הזה ✓");
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
        <div class="card-title rich-content">${renderRichText(o.title)} ${o.qty > 1 ? `<span class="mono" style="color:var(--text-dim);font-size:13px">×${o.qty}</span>` : ""}</div>
      </div>
      <div class="card-meta">
        <span class="tag type">${esc(o.category)}</span>
        ${loc ? `<span class="tag loc">📍 ${esc(loc)}</span>` : ""}
      </div>
      ${o.notes ? `<div class="card-notes"><div class="note-line"><span class="rich-content">${renderRichText(o.notes)}</span></div></div>` : ""}
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
      ${richEditorHTML("f-title", "לדוגמה: כבל NYY 3×2.5", order.title)}
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
      ${richEditorHTML("f-notes", "פרטים נוספים...", order.notes)}
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
    const title = getRichValue("f-title");
    if (!title) { toast("צריך להזין שם פריט"); return; }
    const payload = {
      title,
      category: selCategory,
      qty: parseInt($("#f-qty").value) || 1,
      buildingId: $("#f-building").value || null,
      floorId: $("#f-floor").value || null,
      notes: getRichValue("f-notes"),
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
function openBuildingBlock(buildingId) {
  closeSheet();
  switchView("buildings");
  requestAnimationFrame(() => {
    const block = $(`.building-block[data-id="${buildingId}"]`);
    if (block) {
      block.classList.add("open");
      block.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}
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
  list.innerHTML = buildings.map((b, idx) => `
    <div class="building-block" data-id="${b.id}" data-reorder-item>
      <div class="building-head" data-action="toggle">
        <div class="name"><span class="drag-handle">⠿</span> 🏢 ${esc(b.name)}</div>
        <div class="building-order-btns">
          <button type="button" class="order-btn" data-action="move-up" title="הזז למעלה" ${idx === 0 ? "disabled" : ""}>⬆</button>
          <button type="button" class="order-btn" data-action="move-down" title="הזז למטה" ${idx === buildings.length - 1 ? "disabled" : ""}>⬇</button>
        </div>
        <div class="arrow">⌄</div>
      </div>
      <div class="floor-list">
        ${b.budgetCode ? `<button class="budget-toggle" data-action="toggle-budget">💰 סעיף תקציבי כללי לבניין</button><div class="budget-value">קוד: <b>${esc(b.budgetCode)}</b></div>` : ""}
        <div class="link-row" data-action="open-building-notes" style="cursor:pointer">
          <span>📝 הערות ומשימות כלליות לבניין</span><span>›</span>
        </div>
        <div class="floor-rows-wrap" data-building="${b.id}">
        ${[...b.floors].sort((a, c) => a.order - c.order).map((f) => `
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
  const action = e.target.closest(".drag-handle") ? null : (e.target.dataset.action || (e.target.closest("[data-action]") && e.target.closest("[data-action]").dataset.action));
  if (action === "move-up" || action === "move-down") {
    const wasOpen = block.classList.contains("open");
    Store.moveBuilding(bid, action === "move-up" ? -1 : 1);
    if (state.buildingsSort !== "default") { state.buildingsSort = "default"; Store.setUiPref("buildingsSort", "default"); }
    renderBuildings();
    if (wasOpen) { const blk = $(`.building-block[data-id="${bid}"]`); if (blk) blk.classList.add("open"); }
    return;
  }
  if (action === "toggle" || (!action && !e.target.closest(".drag-handle") && e.target.closest(".building-head"))) {
    const isOpen = block.classList.contains("open");
    if (isOpen) {
      block.classList.remove("open");
      if (block._backClose) { popBackableIfMatches(block._backClose); block._backClose = null; }
    } else {
      block.classList.add("open");
      const closeFn = () => { block.classList.remove("open"); block._backClose = null; };
      block._backClose = closeFn;
      pushBackable(closeFn);
    }
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
$("#buildings-expand-all-btn").addEventListener("click", () => {
  const blocks = $$(".building-block", $("#buildings-list"));
  const anyClosed = blocks.some((b) => !b.classList.contains("open"));
  blocks.forEach((b) => b.classList.toggle("open", anyClosed));
  $("#buildings-expand-all-btn").textContent = anyClosed ? "⇕ סגור הכל" : "⇕ פתח הכל";
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
  const { tasks, orders, notes: notesRaw } = Store.itemsForLocation(buildingId, floorId);
  const notes = [...notesRaw].sort((a, c) => {
    if (state.locNotesSort === "urgencyNum") return compareUrgency(a, c, state.locNotesUrgencyDir);
    if (state.locNotesSort === "created") return c.createdAt - a.createdAt;
    return a.order - c.order;
  });
  return `
    <h3>📍 ${esc(label)}</h3>
    <div class="loc-tabs">
      <div class="loc-tab ${locTab === "notes" ? "active" : ""}" data-tab="notes">הערות (${notes.length})</div>
      <div class="loc-tab ${locTab === "tasks" ? "active" : ""}" data-tab="tasks">משימות (${tasks.length})</div>
      <div class="loc-tab ${locTab === "orders" ? "active" : ""}" data-tab="orders">הזמנות (${orders.length})</div>
    </div>
    <div class="loc-panel ${locTab === "notes" ? "active" : ""}" data-panel="notes">
      ${richEditorHTML("loc-note-input", "הערה חדשה למיקום זה...", "")}
      <div class="inline-add">
        <input type="number" id="loc-note-urgency" placeholder="דחיפות" min="1" step="1" title="מספר דחיפות (אופציונלי, 1 = הכי דחוף)" class="urgency-input">
        <button id="loc-note-add">הוסף הערה</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
        <p class="hint-text" style="margin:0">לחיצה ארוכה על הערה מזיזה את הסדר.</p>
        <button class="sort-btn" id="loc-notes-sort-btn">⇅ מיון</button>
      </div>
      <div id="loc-notes-list">
        ${notes.length ? notes.map((n) => `
          <div class="loc-mini-card ${urgencyColorClass(n)}" data-id="${n.id}" data-reorder-item>
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
              <span class="drag-handle">⠿</span>
              <span class="rich-content" style="flex:1">${renderRichText(n.text)}</span>
              <button class="note-edit" data-edit-note="${n.id}">✏️</button>
              <button class="note-del" data-del-note="${n.id}">✕</button>
            </div>
            <div class="sub">${urgencyBadgeHTML(n)} ${timeAgo(n.createdAt)}</div>
          </div>
        `).join("") : `<p style="color:var(--text-dim);font-size:13.5px">אין הערות עדיין למיקום זה.</p>`}
      </div>
    </div>
    <div class="loc-panel ${locTab === "tasks" ? "active" : ""}" data-panel="tasks">
      <button class="btn-secondary" id="loc-add-task">+ משימה חדשה במיקום זה</button>
      ${tasks.length ? tasks.map((t) => `
        <div class="loc-mini-card" data-open-task="${t.id}" style="cursor:pointer">
          <div class="rich-content">${renderRichText(t.title)}</div>
          <div class="sub">${t.status === "done" ? "✅ בוצע" : t.status === "in_progress" ? "🟡 בביצוע" : "⚪ פתוח"} · ${esc(t.type)}</div>
        </div>
      `).join("") : `<p style="color:var(--text-dim);font-size:13.5px;margin-top:10px">אין משימות במיקום זה.</p>`}
    </div>
    <div class="loc-panel ${locTab === "orders" ? "active" : ""}" data-panel="orders">
      <button class="btn-secondary" id="loc-add-order">+ פריט הזמנה במיקום זה</button>
      ${orders.length ? orders.map((o) => `
        <div class="loc-mini-card" data-open-order="${o.id}" style="cursor:pointer">
          <b class="rich-content">${renderRichText(o.title)}</b>
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
    const text = getRichValue("loc-note-input");
    if (!text) return;
    const urgency = readUrgencyField("loc-note-urgency");
    Store.addLocationNote(buildingId, floorId, text, urgency);
    renderLocationDetail(buildingId, floorId);
    toast("הערה נוספה");
  });
  // (Enter just adds a new line here — no keyboard shortcut to submit, since Shift+Enter
  // isn't practical on a phone keyboard. Use the "הוסף" button to save the note.)
  $("#loc-notes-sort-btn").addEventListener("click", (e) => {
    const options = [
      { value: "manual", label: "סדר ידני (גרירה)" },
      { value: "created", label: "לפי תאריך יצירה (חדש קודם)" },
      { value: "urgencyNum", label: urgencySortLabel(state.locNotesUrgencyDir) },
    ];
    openSortMenu(e.currentTarget, state.locNotesSort, options, (val) => {
      if (val === "urgencyNum") {
        state.locNotesUrgencyDir = (state.locNotesSort === "urgencyNum" && state.locNotesUrgencyDir === "asc") ? "desc" : "asc";
        Store.setUiPref("locNotesUrgencyDir", state.locNotesUrgencyDir);
      }
      state.locNotesSort = val;
      renderLocationDetail(buildingId, floorId);
    });
  });
  $$("[data-del-note]").forEach((btn) => btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await confirmDialog("מחיקת הערה", "למחוק את ההערה?", "מחיקה");
    if (ok) { Store.deleteLocationNote(btn.dataset.delNote); renderLocationDetail(buildingId, floorId); }
  }));
  $$("[data-edit-note]").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEditLocationNoteForm(btn.dataset.editNote, buildingId, floorId);
  }));
  const notesList = $("#loc-notes-list");
  if (notesList) {
    enableLongPressReorder(notesList, "[data-reorder-item]", (ids) => {
      Store.reorderLocationNotes(buildingId, floorId, ids);
      if (state.locNotesSort !== "manual") state.locNotesSort = "manual";
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
function openEditLocationNoteForm(id, buildingId, floorId) {
  const n = Store.data.locationNotes.find((x) => x.id === id);
  if (!n) return;
  openSheet(`
    <h3>עריכת הערה</h3>
    <div class="field">
      <label>תוכן ההערה</label>
      ${richEditorHTML("eln-text", "", n.text)}
    </div>
    ${urgencyFieldHTML("eln-urgency", n.urgency)}
    <button class="btn-primary" id="eln-save">שמירה</button>
  `);
  $("#eln-save").addEventListener("click", () => {
    const text = getRichValue("eln-text");
    if (!text) { toast("צריך להזין תוכן"); return; }
    Store.updateLocationNote(id, { text, urgency: readUrgencyField("eln-urgency") });
    closeSheet();
    renderLocationDetail(buildingId, floorId);
    toast("נשמר");
  });
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
        <div class="card-title rich-content">${renderRichText(q.text)}</div>
      </div>
      ${q.relatedTo ? `<div class="card-meta"><span class="tag">👤 ${esc(q.relatedTo)}</span></div>` : ""}
      ${q.answer ? `<div class="card-notes"><div class="note-line"><span class="rich-content">💬 ${renderRichText(q.answer)}</span></div></div>` : ""}
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
    <div class="field"><label>מה השאלה / הבעיה</label>${richEditorHTML("f-text", "לדוגמה: לבדוק מול קבלן הבטון לגבי מיקום שרוולים בקומה 2", q.text)}</div>
    <div class="field"><label>קשור ל (אופציונלי)</label><input type="text" id="f-related" value="${esc(q.relatedTo)}" placeholder="לדוגמה: קבלן בטון / מתכנן חשמל"></div>
    <button class="btn-primary" id="save-question">שמירה</button>
  `;
}
function openQuestionForm(qid) {
  const q = qid ? Store.data.questions.find((x) => x.id === qid) : null;
  openSheet(questionFormHTML(q));
  $("#save-question").addEventListener("click", () => {
    const text = getRichValue("f-text");
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
function quickNoteFormHTML() {
  return `
    <h3>הערה חדשה</h3>
    <div class="field">
      <label>שיוך (השאירו על "הערה כללית" אם לא שייך למקום מסוים)</label>
      <select id="qn-building"><option value="">— הערה כללית —</option>${Store.data.buildings.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}</select>
    </div>
    <div class="field" id="qn-floor-field" style="display:none">
      <label>קומה (אופציונלי — ניתן להשאיר על כל הבניין)</label>
      <select id="qn-floor"></select>
    </div>
    <div class="field">
      <label>תוכן ההערה</label>
      ${richEditorHTML("qn-text", "כתוב כאן...", "")}
    </div>
    ${urgencyFieldHTML("qn-urgency", null)}
    <button class="btn-primary" id="qn-save">שמירה</button>
  `;
}
function openQuickNoteForm(presetLocation) {
  openSheet(quickNoteFormHTML());
  const bSel = $("#qn-building"), fField = $("#qn-floor-field"), fSel = $("#qn-floor");
  function refreshFloors() {
    const b = Store.data.buildings.find((x) => x.id === bSel.value);
    if (b) {
      fField.style.display = "";
      fSel.innerHTML = `<option value="">— כל הבניין (ללא קומה ספציפית) —</option>` + b.floors.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("");
    } else {
      fField.style.display = "none";
      fSel.innerHTML = "";
    }
  }
  bSel.addEventListener("change", refreshFloors);
  if (presetLocation && presetLocation.buildingId) bSel.value = presetLocation.buildingId;
  refreshFloors();
  if (presetLocation && presetLocation.floorId) fSel.value = presetLocation.floorId;
  $("#qn-save").addEventListener("click", () => {
    const text = getRichValue("qn-text");
    if (!text) return;
    const urgency = readUrgencyField("qn-urgency");
    if (bSel.value) Store.addLocationNote(bSel.value, fSel.value || null, text, urgency);
    else Store.addGeneralNote(text, urgency);
    closeSheet();
    renderGeneralNotes();
    toast("הערה נוספה");
  });
}
function renderGeneralNotes() {
  const list = $("#general-notes-list");
  const items = [...Store.data.generalNotes].sort((a, b) => {
    if (state.generalNotesSort === "created") return b.createdAt - a.createdAt;
    if (state.generalNotesSort === "urgencyNum") return compareUrgency(a, b, state.generalNotesUrgencyDir);
    return a.order - b.order;
  });
  if (!items.length) { list.innerHTML = `<div class="empty-state" style="padding:20px"><p>אין הערות כלליות.</p></div>`; return; }
  list.innerHTML = items.map((n) => `
    <div class="card ${urgencyColorClass(n)}" data-id="${n.id}" data-reorder-item style="padding:12px">
      <div class="note-line" style="font-size:14px;color:var(--text)">
        <span class="drag-handle">⠿</span>
        <span class="rich-content" style="flex:1">${renderRichText(n.text)}</span>
        <button class="note-edit" data-action="edit-note">✏️</button>
        <button class="note-del" data-action="delete-note">✕</button>
      </div>
      <div class="card-meta" style="margin-top:4px">
        ${urgencyBadgeHTML(n)}
        <span style="font-size:11px;color:var(--text-dim)">${timeAgo(n.createdAt)}</span>
      </div>
    </div>
  `).join("");
  list.onclick = async (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.dataset.action === "delete-note") {
      const ok = await confirmDialog("מחיקת הערה", "למחוק את ההערה?", "מחיקה");
      if (ok) { Store.deleteGeneralNote(id); renderGeneralNotes(); }
      return;
    }
    if (e.target.dataset.action === "edit-note") {
      openEditGeneralNoteForm(id);
    }
  };
}
function openEditGeneralNoteForm(id) {
  const n = Store.data.generalNotes.find((x) => x.id === id);
  if (!n) return;
  openSheet(`
    <h3>עריכת הערה</h3>
    <div class="field">
      <label>תוכן ההערה</label>
      ${richEditorHTML("en-text", "", n.text)}
    </div>
    ${urgencyFieldHTML("en-urgency", n.urgency)}
    <button class="btn-primary" id="en-save">שמירה</button>
  `);
  $("#en-save").addEventListener("click", () => {
    const text = getRichValue("en-text");
    if (!text) { toast("צריך להזין תוכן"); return; }
    Store.updateGeneralNote(id, { text, urgency: readUrgencyField("en-urgency") });
    closeSheet();
    renderGeneralNotes();
    toast("נשמר");
  });
}
enableLongPressReorder($("#general-notes-list"), "[data-reorder-item]", (ids) => {
  Store.reorderGeneralNotes(ids);
  if (state.generalNotesSort !== "manual") { state.generalNotesSort = "manual"; Store.setUiPref("generalNotesSort", "manual"); }
  renderGeneralNotes();
});
$("#general-notes-sort-btn").addEventListener("click", (e) => {
  const options = [
    { value: "manual", label: "סדר ידני (גרירה)" },
    { value: "created", label: "לפי תאריך יצירה (חדש קודם)" },
    { value: "urgencyNum", label: urgencySortLabel(state.generalNotesUrgencyDir) },
  ];
  openSortMenu(e.currentTarget, state.generalNotesSort, options, (val) => {
    if (val === "urgencyNum") {
      state.generalNotesUrgencyDir = (state.generalNotesSort === "urgencyNum" && state.generalNotesUrgencyDir === "asc") ? "desc" : "asc";
      Store.setUiPref("generalNotesUrgencyDir", state.generalNotesUrgencyDir);
    }
    state.generalNotesSort = val; Store.setUiPref("generalNotesSort", val); renderGeneralNotes();
  });
});
$("#general-note-input-wrap").innerHTML = richEditorHTML("general-note-input", "הערה חדשה...", "");
$("#general-note-add").addEventListener("click", () => {
  const text = getRichValue("general-note-input");
  if (!text) return;
  const urgency = readUrgencyField("general-note-urgency");
  Store.addGeneralNote(text, urgency);
  $("#general-note-input").innerHTML = "";
  const uInput = $("#general-note-urgency");
  if (uInput) uInput.value = "";
  renderGeneralNotes();
  toast("הערה נוספה");
});
// (Enter just adds a new line in the note box — use the "הוסף" button to save.)

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
// ---------------- Settings: urgency color-coding toggle ----------------
const urgencyColorsToggle = $("#urgency-colors-toggle");
urgencyColorsToggle.checked = Store.data.uiPrefs.urgencyColorsEnabled !== false;
urgencyColorsToggle.addEventListener("change", () => {
  Store.setUiPref("urgencyColorsEnabled", urgencyColorsToggle.checked);
  renderAll();
  toast(urgencyColorsToggle.checked ? "צביעת דחיפות הופעלה" : "צביעת דחיפות בוטלה");
});

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
      applyImportedJSON(reader.result);
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


// ==========================================================
// Cloud backup (Google account) — automatic, free (Firebase Spark plan, no credit card)
// ==========================================================
function applyImportedJSON(json) {
  Store.importJSON(json);
  Object.assign(state, {
    tasksSort: Store.data.uiPrefs.tasksSort,
    ordersSort: Store.data.uiPrefs.ordersSort,
    questionsSort: Store.data.uiPrefs.questionsSort,
    buildingsSort: Store.data.uiPrefs.buildingsSort,
  });
  renderAll();
}

const fmtDateTime = (ts) => ts ? new Date(ts).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" }) : "—";
const fmtCounts = (c) => c ? `${c.tasks || 0} משימות · ${c.orders || 0} הזמנות · ${c.buildings || 0} בניינים · ${c.questions || 0} שאלות` : "";
const localDayId = () => { const d = new Date(); const p = (n) => String(n).padStart(2, "0"); return `day-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } };

const Backup = {
  reconciled: false,   // לא מעלים לענן לפני שבדקנו מה כבר יש שם
  reconciling: false,
  timer: null,
  busy: false,
  lastPushedJson: null,
  lastError: "",
  pruned: false,

  cloud() { return window.CloudSync; },
  signedIn() { const c = this.cloud(); return !!(c && c.enabled && c.isGoogle); },
  lastAt() { return Number(lsGet("elec_last_backup_at")) || 0; },

  schedule() {
    if (!this.signedIn() || !this.reconciled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 4000);
  },
  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; this.push(); }
  },

  async push(force = false) {
    if (!this.signedIn() || !this.reconciled || this.busy) return false;
    // הגנה: לעולם לא דורסים גיבוי בנתונים ריקים (למשל אחרי מחיקת נתוני אתר)
    if (!Store.hasContent()) { this.lastError = ""; return false; }
    const json = JSON.stringify(Store.data);
    if (!force && json === this.lastPushedJson) return true;
    this.busy = true;
    try {
      const counts = Store.counts();
      await this.cloud().putBackup("latest", json, counts);
      await this.cloud().putBackup(localDayId(), json, counts);
      this.lastPushedJson = json;
      lsSet("elec_last_backup_at", String(Date.now()));
      this.lastError = "";
      this.pruneOld();
      return true;
    } catch (e) {
      this.lastError = (e && (e.code || e.message)) || String(e);
      console.error("[backup] push failed:", e);
      return false;
    } finally {
      this.busy = false;
      updateBackupLabel();
    }
  },

  // שומר רק 14 גיבויים יומיים אחרונים
  async pruneOld() {
    if (this.pruned) return;
    this.pruned = true;
    try {
      const list = await this.cloud().listBackups();
      const days = list.filter((b) => b.id.startsWith("day-")).sort((a, b) => b.id.localeCompare(a.id));
      for (const b of days.slice(14)) await this.cloud().deleteBackup(b.id);
    } catch (e) { /* לא קריטי */ }
  },

  // נקרא מיד אחרי התחברות/פתיחת האפליקציה עם משתמש Google
  async reconcile() {
    if (this.reconciled || this.reconciling || !this.signedIn()) return;
    this.reconciling = true;
    try {
      const cloud = await this.cloud().getBackup("latest");
      const localHas = Store.hasContent();
      if (!cloud) {
        this.reconciled = true;
        if (localHas) this.push(true);
        return;
      }
      const same = cloud.json === JSON.stringify(Store.data);
      if (!localHas) {
        const ok = await confirmDialog("נמצא גיבוי בענן",
          `המכשיר הזה ריק, אבל בענן יש גיבוי מ-${fmtDateTime(cloud.savedAt)}\n(${fmtCounts(cloud.counts)}).\n\nלשחזר אותו עכשיו?`, "שחזר", false);
        if (ok) { applyImportedJSON(cloud.json); this.lastPushedJson = cloud.json; lsSet("elec_last_backup_at", String(Date.now())); toast("הנתונים שוחזרו מהענן"); }
        this.reconciled = true;
        return;
      }
      if (!same && cloud.savedAt > this.lastAt()) {
        // בענן יש גרסה חדשה יותר ממה שהמכשיר הזה גיבה לאחרונה (למשל עבודה ממכשיר אחר)
        const choice = await chooseDialog("גיבוי חדש יותר בענן",
          `בענן יש גיבוי מ-${fmtDateTime(cloud.savedAt)} (${fmtCounts(cloud.counts)}) שחדש מהגיבוי האחרון של המכשיר הזה.\n\nמה לעשות?`,
          [
            { label: "השאר את הנתונים במכשיר", value: "local", style: "ghost" },
            { label: "שחזר מהענן", value: "cloud", style: "primary" },
          ]);
        if (choice === "cloud") {
          await this.safetyCopy();
          applyImportedJSON(cloud.json); this.lastPushedJson = cloud.json; lsSet("elec_last_backup_at", String(Date.now()));
          toast("הנתונים שוחזרו מהענן");
          this.reconciled = true;
          return;
        }
        if (choice !== "local") return; // נסגר בלי בחירה — נשאל שוב בפעם הבאה, ובינתיים לא מעלים
        await this.safetyCopy(cloud.json);
      }
      this.reconciled = true;
      this.push(true);
    } catch (e) {
      this.lastError = (e && (e.code || e.message)) || String(e);
      console.error("[backup] reconcile failed:", e);
    } finally {
      this.reconciling = false;
      updateBackupLabel();
    }
  },

  // עותק ביטחון לפני כל פעולה שדורסת נתונים (מקומיים או ענן)
  async safetyCopy(jsonOverride) {
    try {
      const json = jsonOverride || (Store.hasContent() ? JSON.stringify(Store.data) : null);
      if (json) await this.cloud().putBackup("pre-restore", json, jsonOverride ? {} : Store.counts());
    } catch (e) { console.error("[backup] safety copy failed:", e); }
  },
};

window.addEventListener("store-changed", () => Backup.schedule());
document.addEventListener("visibilitychange", () => { if (document.hidden) Backup.flush(); });
window.addEventListener("pagehide", () => Backup.flush());

function updateBackupLabel() {
  const el = $("#backup-account-label");
  if (!el) return;
  const c = window.CloudSync;
  if (!c || !c.enabled) { el.textContent = "Firebase לא מוגדר"; return; }
  if (!c.isGoogle) { el.textContent = "לא מחובר — לחץ להתחברות ›"; return; }
  const email = (c.user && c.user.email) || "";
  if (Backup.lastError) el.textContent = "⚠️ שגיאה — לחץ לפרטים";
  else if (!Backup.reconciled) el.textContent = "בודק גיבוי...";
  else el.textContent = `✅ ${email} · ${Backup.lastAt() ? fmtDateTime(Backup.lastAt()) : "טרם גובה"}`;
}

window.addEventListener("backup-auth", () => {
  updateBackupLabel();
  if (Backup.signedIn()) Backup.reconcile();
});
window.addEventListener("cloud-ready", () => {
  updateBackupLabel();
  // תזכורת עדינה (לכל היותר פעם ב-3 ימים) כל עוד הגיבוי לענן לא מופעל
  const c = window.CloudSync;
  if (c && c.enabled && !c.isGoogle) {
    const last = Number(lsGet("elec_backup_nag_at")) || 0;
    if (Date.now() - last > 3 * 86400000) {
      lsSet("elec_backup_nag_at", String(Date.now()));
      setTimeout(async () => {
        if (window.CloudSync.isGoogle) return;
        const ok = await confirmDialog("גיבוי לענן לא מופעל",
          "כרגע הנתונים נשמרים רק בטלפון הזה, ומחיקת נתוני אתר בדפדפן תמחק אותם. להפעיל גיבוי אוטומטי חינמי לחשבון Google?", "התחבר עכשיו", false);
        if (ok) signInForBackup();
      }, 1500);
    }
  }
});

async function signInForBackup() {
  try {
    await window.CloudSync.signInGoogle();
    toast("מחובר — מתחיל גיבוי");
  } catch (e) {
    const code = (e && e.code) || (e && e.message) || String(e);
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
    let hint = "";
    if (code === "auth/unauthorized-domain") hint = "\n\nיש להוסיף את הדומיין של האתר (למשל yourname.github.io) ב-Firebase → Authentication → Settings → Authorized domains.";
    else if (code === "auth/operation-not-allowed") hint = "\n\nיש להפעיל את ספק Google ב-Firebase → Authentication → Sign-in method.";
    else if (code === "auth/popup-blocked") hint = "\n\nהדפדפן חסם את חלון ההתחברות — יש לאשר חלונות קופצים לאתר ולנסות שוב.";
    await alertDialog("ההתחברות נכשלה", `${code}${hint}\n\nראה SETUP-BACKUP.md.`);
  }
}

$("#backup-account-row").addEventListener("click", async () => {
  const c = window.CloudSync;
  if (!c || !c.enabled) { await alertDialog("Firebase לא מוגדר", "ראה SETUP-CLOUD.md ו-SETUP-BACKUP.md."); return; }
  if (!c.isGoogle) { await signInForBackup(); return; }
  if (Backup.lastError) {
    await alertDialog("שגיאת גיבוי", `${Backup.lastError}\n\nהסיבה הנפוצה: חוקי Firestore החדשים (firestore.rules) לא הודבקו ופורסמו. ראה SETUP-BACKUP.md.`);
  }
  const choice = await chooseDialog("חשבון גיבוי", `מחובר כ-${(c.user && c.user.email) || ""}`, [
    { label: "סגור", value: null, style: "ghost" },
    { label: "התנתק", value: "out", style: "danger" },
  ]);
  if (choice === "out") {
    await c.signOutGoogle();
    Backup.reconciled = false; Backup.lastPushedJson = null;
    toast("התנתקת — הגיבוי האוטומטי כבוי");
    updateBackupLabel();
  }
});

$("#backup-now-row").addEventListener("click", async () => {
  if (!Backup.signedIn()) { toast("יש להתחבר קודם לחשבון Google"); return; }
  if (!Backup.reconciled) { await Backup.reconcile(); }
  if (!Store.hasContent()) { toast("אין נתונים לגיבוי — הגיבוי בענן נשמר ולא נדרס"); return; }
  toast("מגבה...");
  const ok = await Backup.push(true);
  toast(ok ? "☁️ גובה בהצלחה" : "הגיבוי נכשל — לחץ על שורת החשבון לפרטים");
});

$("#backup-restore-row").addEventListener("click", async () => {
  if (!Backup.signedIn()) { toast("יש להתחבר קודם לחשבון Google"); return; }
  let list;
  try { list = await window.CloudSync.listBackups(); }
  catch (e) { await alertDialog("שגיאה", `${(e && (e.code || e.message)) || e}`); return; }
  if (!list.length) { await alertDialog("שחזור מהענן", "עדיין אין גיבויים בענן."); return; }
  const label = (id) => id === "latest" ? "הגיבוי האחרון" : id === "pre-restore" ? "עותק ביטחון (לפני שחזור)" : `גיבוי יומי ${id.slice(4).split("-").reverse().join("/")}`;
  openSheet(`<h3 style="margin:0 0 10px">שחזור מהענן</h3>
    <p class="hint-text">בחר גיבוי לשחזור. הנתונים הנוכחיים במכשיר יוחלפו (נשמר עותק ביטחון).</p>
    <div class="settings-group">${list.map((b) => `
      <div class="link-row" data-restore="${esc(b.id)}" style="cursor:pointer;flex-direction:column;align-items:flex-start;gap:2px">
        <span>${esc(label(b.id))}</span>
        <span class="hint-text" style="margin:0">${esc(fmtDateTime(b.savedAt))} · ${esc(fmtCounts(b.counts))}</span>
      </div>`).join("")}</div>`);
  $$("[data-restore]", $("#sheet-content")).forEach((row) => row.addEventListener("click", async () => {
    const id = row.dataset.restore;
    const ok = await confirmDialog("שחזור גיבוי", "הנתונים הנוכחיים במכשיר יוחלפו בגיבוי שנבחר. להמשיך?", "שחזר", false);
    if (!ok) return;
    try {
      const b = await window.CloudSync.getBackup(id);
      if (!b) { toast("הגיבוי לא נמצא"); return; }
      await Backup.safetyCopy();
      applyImportedJSON(b.json);
      Backup.lastPushedJson = null;
      closeSheet();
      toast("הנתונים שוחזרו מהענן");
    } catch (e) { await alertDialog("שחזור נכשל", `${(e && (e.code || e.message)) || e}`); }
  }));
});
updateBackupLabel();

// מבקש מהדפדפן לא למחוק את נתוני האתר אוטומטית כשנגמר מקום (לא מגן ממחיקה ידנית — לכן יש גיבוי לענן)
if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(() => {}); }

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
  if ("Notification" in window && Notification.permission === "granted") subscribeToPush(true);
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
    case "more": openQuickNoteForm(); break;
  }
});

// ==========================================================
// Smart search — live results across everything, in a sheet
// ==========================================================
// ==========================================================
// Hebrew-aware normalization for search — so "מילה"/"מלה", "תוכנית"/"תכנית" and
// "דו״ח"/"דוח" (with or without gershayim/apostrophes) are all treated as the same word,
// and searching part of a word still finds it.
// ==========================================================
const HEB_FINAL_MAP = { "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" };
function hebNormalize(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .replace(/[\u0591-\u05C7]/g, "") // niqqud / cantillation marks
    .replace(/["'׳״]/g, "") // gershayim/geresh/quotes: דו"ח <-> דוח, ה' <-> ה
    .replace(/[ךםןףץ]/g, (c) => HEB_FINAL_MAP[c]) // sofit -> regular letter
    .replace(/(?<=\S)[וי]/g, "") // drop internal ו/י (plene/defective spelling): מילה<->מלה, תוכנית<->תכנית
    .replace(/\s+/g, " ")
    .trim();
}
// Builds a lenient regex for highlighting: matches the term in the *original* (un-normalized)
// text even when it has extra/missing ו,י or quote marks compared to what was typed.
function hebLooseRegex(term) {
  const optional = `["'׳״וי]{0,2}`;
  const body = [...term]
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(optional);
  try { return new RegExp(`(${body}${optional})`, "gi"); } catch (e) { return null; }
}
function highlight(text, terms) {
  let out = esc(text || "");
  terms.forEach((t) => {
    if (!t) return;
    const re = hebLooseRegex(t) || new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return out;
}
function runSearch(query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean).map(hebNormalize).filter(Boolean);
  if (!terms.length) return null;
  const matchAll = (fields) => {
    const hay = hebNormalize(fields.join(" "));
    return terms.every((t) => hay.includes(t));
  };
  const groups = [];

  const taskMatches = Store.data.tasks.filter((t) => matchAll([stripRichText(t.title), t.type, locationLabel(t) || "", ...t.notes.map((n) => n.text)]));
  if (taskMatches.length) groups.push({ title: "משימות", icon: "✅", items: taskMatches.map((t) => ({ title: stripRichText(t.title), sub: [t.type, locationLabel(t)].filter(Boolean).join(" · "), action: () => openTaskForm(t.id) })) });

  const orderMatches = Store.data.orders.filter((o) => matchAll([stripRichText(o.title), o.category, stripRichText(o.notes) || "", locationLabel(o) || ""]));
  if (orderMatches.length) groups.push({ title: "הזמנות", icon: "📦", items: orderMatches.map((o) => ({ title: stripRichText(o.title), sub: [o.category, locationLabel(o)].filter(Boolean).join(" · "), action: () => openOrderForm(o.id) })) });

  const qMatches = Store.data.questions.filter((q) => matchAll([stripRichText(q.text), q.relatedTo || "", stripRichText(q.answer) || ""]));
  if (qMatches.length) groups.push({ title: "שאלות ובעיות", icon: "❓", items: qMatches.map((q) => ({ title: stripRichText(q.text), sub: q.relatedTo || (q.answer ? "נענה" : "פתוח"), action: () => openQuestionForm(q.id) })) });

  const buildingMatches = [];
  Store.data.buildings.forEach((b) => {
    if (matchAll([b.name])) buildingMatches.push({ title: b.name, sub: `${b.floors.length} קומות`, action: () => openBuildingBlock(b.id) });
    b.floors.forEach((f) => {
      if (matchAll([b.name, f.name])) buildingMatches.push({ title: `${b.name} · ${f.name}`, sub: "קומה", action: () => openLocationDetail(b.id, f.id) });
    });
  });
  if (buildingMatches.length) groups.push({ title: "בניינים וקומות", icon: "🏢", items: buildingMatches });

  const locNoteMatches = Store.data.locationNotes.filter((n) => matchAll([stripRichText(n.text)]));
  if (locNoteMatches.length) groups.push({ title: "הערות מיקום", icon: "📍", items: locNoteMatches.map((n) => {
    const b = Store.data.buildings.find((x) => x.id === n.buildingId);
    const label = b ? (n.floorId ? `${b.name} · ${floorName(b.id, n.floorId)}` : b.name) : "";
    return { title: stripRichText(n.text), sub: label, action: () => openLocationDetail(n.buildingId, n.floorId) };
  }) });

  const genNoteMatches = Store.data.generalNotes.filter((n) => matchAll([stripRichText(n.text)]));
  if (genNoteMatches.length) groups.push({ title: "הערות כלליות", icon: "🗒️", items: genNoteMatches.map((n) => ({ title: stripRichText(n.text), sub: timeAgo(n.createdAt), action: () => switchView("more") })) });

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
// Floating quick-search pill — appears while scrolling back up through a long list
// (without needing to reach the very top), so search is always one tap away.
// ==========================================================
(() => {
  const fab = $("#quick-search-fab");
  let lastY = window.scrollY;
  fab.addEventListener("click", openSearchSheet);
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    const scrollingUp = y < lastY - 4;
    const scrollingDown = y > lastY + 4;
    if (y < 80) {
      fab.classList.remove("show"); // header/search button already visible near the top
    } else if (scrollingUp) {
      fab.classList.add("show");
    } else if (scrollingDown) {
      fab.classList.remove("show");
    }
    lastY = y;
  }, { passive: true });
})();

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

let waitingWorker = null;
let refreshingAfterUpdate = false;

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`sw.js?v=${APP_VERSION}`).then((reg) => {
      // check for update every time the app is opened
      reg.update();
      if (reg.waiting && navigator.serviceWorker.controller) {
        waitingWorker = reg.waiting;
        $("#update-banner").classList.add("show");
      }

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            waitingWorker = newWorker;
            $("#update-banner").classList.add("show");
          }
        });
      });

      $("#check-update-btn").addEventListener("click", () => {
        reg.update().then(() => {
          if (reg.installing || reg.waiting) {
            toast("נמצא עדכון חדש — מתקין ברקע, האפליקציה תרענן את עצמה עוד רגע");
          } else {
            toast("נבדק — זו כבר הגרסה האחרונה");
          }
        });
      });
    }).catch((err) => console.error("SW registration failed", err));

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshingAfterUpdate) return;
      refreshingAfterUpdate = true;
      window.location.reload();
    });
  });
}
$("#update-btn").addEventListener("click", () => {
  if (waitingWorker) {
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
    toast("מעדכן...");
    // controllerchange normally reloads us; this is just a safety net in case it doesn't fire
    setTimeout(() => { if (!refreshingAfterUpdate) { refreshingAfterUpdate = true; window.location.reload(); } }, 1500);
  } else {
    window.location.reload();
  }
});

// ---------------- init ----------------
renderAll();
checkReminders();
setInterval(checkReminders, 20000);
// Every time the app comes back to the foreground, re-verify (and if needed re-save) the
// push subscription — this is the main safety net against "reminders quietly stopped
// working when the app is closed" over time (an OS/browser can silently invalidate a push
// subscription; without this it would only get noticed/fixed the next time the person
// happens to open Settings and tap the cloud reminders row). Throttled to once per hour
// so it doesn't hammer Firestore on every tab switch.
let lastPushRecheck = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  checkReminders();
  const now = Date.now();
  if (now - lastPushRecheck < 3600000) return;
  lastPushRecheck = now;
  if ("Notification" in window && Notification.permission === "granted" && window.CloudSync && window.CloudSync.enabled) {
    subscribeToPush(true);
  }
});
