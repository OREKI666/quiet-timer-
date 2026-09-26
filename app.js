"use strict";

const APP_NAME = "林林时间";
const DB_NAME = "quiet-timer-db";
const DB_VERSION = 1;
const STORE_NAME = "records";
const ACTIVE_KEY = "quiet-timer-active";

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const el = {
  views: $$(".view"),
  homeView: $("#homeView"),
  timerView: $("#timerView"),
  completeView: $("#completeView"),
  timerForm: $("#timerForm"),
  eventName: $("#eventName"),
  location: $("#location"),
  formMessage: $("#formMessage"),
  recentEvents: $("#recentEvents"),
  recentLocations: $("#recentLocations"),
  historyList: $("#historyList"),
  emptyHistory: $("#emptyHistory"),
  recordCount: $("#recordCount"),
  timerEventName: $("#timerEventName"),
  timerLocation: $("#timerLocation"),
  countdown: $("#countdown"),
  timerStatus: $("#timerStatus"),
  pauseButton: $("#pauseButton"),
  finishButton: $("#finishEarlyButton"),
  completeSummary: $("#completeSummary"),
  completeHomeButton: $("#completeHomeButton"),
  recordDialog: $("#recordDialog"),
  recordForm: $("#recordForm"),
  closeRecordButton: $("#closeRecordButton"),
  cancelRecordButton: $("#cancelRecordButton"),
  editRecordId: $("#editRecordId"),
  editEventName: $("#editEventName"),
  editLocation: $("#editLocation"),
  settingsDialog: $("#settingsDialog"),
  settingsButton: $("#settingsButton"),
  closeSettingsButton: $("#closeSettingsButton"),
  exportButton: $("#exportButton"),
  importInput: $("#importInput"),
  clearButton: $("#clearButton"),
  settingsMessage: $("#settingsMessage")
};

let dbPromise = null;
let activeTimer = null;
let ticker = null;
let saving = false;

function showView(view) {
  el.views.forEach((v) => {
    const active = v === view;
    v.hidden = !active;
    v.classList.toggle("view--active", active);
  });
  window.scrollTo(0, 0);
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("endTime", "endTime");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function storeRequest(mode, callback) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = callback(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const records = {
  all: async () => {
    const list = await storeRequest("readonly", (s) => s.getAll());
    return list.sort((a, b) => (b.endTime || 0) - (a.endTime || 0));
  },
  get: (id) => storeRequest("readonly", (s) => s.get(id)),
  put: (record) => storeRequest("readwrite", (s) => s.put(record)),
  delete: (id) => storeRequest("readwrite", (s) => s.delete(id)),
  clear: () => storeRequest("readwrite", (s) => s.clear())
};

function makeId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "timer-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

function saveActive() {
  if (activeTimer) localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeTimer));
  else localStorage.removeItem(ACTIVE_KEY);
}

function loadActive() {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_KEY));
    if (!value || !value.id || !value.eventName || !Number.isFinite(value.startTime)) return null;
    if (!Number.isFinite(value.totalPausedMs)) value.totalPausedMs = 0;
    if (typeof value.paused !== "boolean") value.paused = false;
    return value;
  } catch {
    localStorage.removeItem(ACTIVE_KEY);
    return null;
  }
}

function elapsedMs() {
  if (!activeTimer) return 0;
  const end = activeTimer.paused && Number.isFinite(activeTimer.pauseStartedAt)
    ? activeTimer.pauseStartedAt
    : Date.now();
  return Math.max(0, end - activeTimer.startTime - (activeTimer.totalPausedMs || 0));
}

function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0")
    : String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
}

function formatDuration(seconds) {
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  if (sec < 60) return sec + "秒";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? m + "分" + s + "秒" : m + "分钟";
}

function updateClock() {
  if (!activeTimer) return;
  const text = formatClock(elapsedMs());
  el.countdown.textContent = text;
  document.title = text + " · " + activeTimer.eventName;
}

function startTicker() {
  if (ticker) clearInterval(ticker);
  updateClock();
  ticker = setInterval(updateClock, 500);
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function showTimer() {
  if (!activeTimer) return;
  el.timerEventName.textContent = activeTimer.eventName;
  el.timerLocation.textContent = activeTimer.location ? "在 " + activeTimer.location : "";
  el.pauseButton.textContent = activeTimer.paused ? "继续" : "暂停";
  el.timerStatus.textContent = activeTimer.paused ? "先停在这里" : "正在计时";
  el.timerView.classList.toggle("is-paused", activeTimer.paused);
  showView(el.timerView);
  startTicker();
}

function startTimer(event) {
  event.preventDefault();
  const eventName = el.eventName.value.trim();
  const location = el.location.value.trim();

  if (!eventName) {
    el.formMessage.textContent = "先写下要做的事。";
    el.eventName.focus();
    return;
  }

  el.formMessage.textContent = "";
  activeTimer = {
    id: makeId(),
    eventName,
    location,
    startTime: Date.now(),
    paused: false,
    pauseStartedAt: null,
    totalPausedMs: 0
  };
  saveActive();
  showTimer();
}

function togglePause() {
  if (!activeTimer) return;

  if (activeTimer.paused) {
    const now = Date.now();
    if (Number.isFinite(activeTimer.pauseStartedAt)) {
      activeTimer.totalPausedMs += Math.max(0, now - activeTimer.pauseStartedAt);
    }
    activeTimer.paused = false;
    activeTimer.pauseStartedAt = null;
  } else {
    activeTimer.paused = true;
    activeTimer.pauseStartedAt = Date.now();
  }

  saveActive();
  showTimer();
}

async function finishTimer() {
  if (!activeTimer || saving) return;
  saving = true;
  stopTicker();

  const timer = { ...activeTimer };
  const ms = elapsedMs();
  const actualSeconds = Math.max(0, Math.floor(ms / 1000));
  const now = Date.now();

  const record = {
    id: timer.id,
    eventName: timer.eventName,
    location: timer.location || "",
    startTime: timer.startTime,
    endTime: now,
    plannedMinutes: 0,
    actualMinutes: Math.round(actualSeconds / 60),
    actualSeconds,
    status: "完成"
  };

  try {
    await records.put(record);
    activeTimer = null;
    saveActive();
    document.title = APP_NAME + " · 极简事件计时器";
    el.completeSummary.textContent = record.eventName + " · " + formatDuration(actualSeconds);
    showView(el.completeView);
  } catch (error) {
    console.error(error);
    el.timerStatus.textContent = "保存失败，请再试一次";
    startTicker();
  } finally {
    saving = false;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function groupLabel(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const thatDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((today - thatDay) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return (d.getMonth() + 1) + "月" + d.getDate() + "日";
}

async function renderHistory() {
  try {
    const list = await records.all();
    el.recordCount.textContent = list.length ? list.length + " 条" : "";
    el.emptyHistory.hidden = list.length > 0;
    el.historyList.innerHTML = "";

    const groups = new Map();
    list.forEach((record) => {
      const label = groupLabel(record.endTime);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(record);
    });

    groups.forEach((items, label) => {
      const section = document.createElement("section");
      section.className = "history-group";
      section.innerHTML = '<h3 class="history-group-title">' + escapeHtml(label) + "</h3>";

      items.forEach((record) => {
        const d = new Date(record.endTime);
        const dateText = (d.getMonth() + 1) + "/" + d.getDate();
        const timeText = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
        const seconds = Number.isFinite(record.actualSeconds)
          ? record.actualSeconds
          : Math.max(0, Math.round((record.actualMinutes || 0) * 60));
        const meta = [record.location, formatDuration(seconds)].filter(Boolean).join(" · ");

        const row = document.createElement("article");
        row.className = "record-row";
        row.innerHTML =
          '<time class="record-time" datetime="' + new Date(record.endTime).toISOString() + '">' +
          escapeHtml(dateText) + "<br>" + escapeHtml(timeText) + "</time>" +
          '<div class="record-main"><strong>' + escapeHtml(record.eventName) + "</strong><span>" + escapeHtml(meta) + "</span></div>" +
          '<div class="record-actions">' +
          '<button class="record-action" type="button" data-action="edit" data-id="' + escapeHtml(record.id) + '">修改</button>' +
          '<button class="record-action record-action--delete" type="button" data-action="delete" data-id="' + escapeHtml(record.id) + '">删除</button>' +
          "</div>";
        section.appendChild(row);
      });

      el.historyList.appendChild(section);
    });

    renderRecent(list);
  } catch (error) {
    console.error(error);
    el.emptyHistory.hidden = false;
    el.emptyHistory.querySelector("p").textContent = "暂时读不到记录";
  }
}

function renderRecent(list) {
  const unique = (key) => Array.from(new Set(list.map((r) => (r[key] || "").trim()).filter(Boolean))).slice(0, 4);

  function draw(container, values, input) {
    container.innerHTML = "";
    values.forEach((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quick-chip";
      button.textContent = value;
      button.addEventListener("click", () => {
        input.value = value;
        input.focus();
      });
      container.appendChild(button);
    });
  }

  draw(el.recentEvents, unique("eventName"), el.eventName);
  draw(el.recentLocations, unique("location"), el.location);
}

async function handleHistoryClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const record = await records.get(button.dataset.id);
  if (!record) return;

  if (button.dataset.action === "edit") {
    el.editRecordId.value = record.id;
    el.editEventName.value = record.eventName || "";
    el.editLocation.value = record.location || "";
    if (typeof el.recordDialog.showModal === "function") el.recordDialog.showModal();
    else el.recordDialog.setAttribute("open", "");
  }

  if (button.dataset.action === "delete") {
    if (!confirm("删除“" + record.eventName + "”这条记录吗？")) return;
    await records.delete(record.id);
    await renderHistory();
  }
}

async function saveRecordEdit(event) {
  event.preventDefault();
  const name = el.editEventName.value.trim();
  if (!name) return;
  const record = await records.get(el.editRecordId.value);
  if (!record) return;
  record.eventName = name;
  record.location = el.editLocation.value.trim();
  await records.put(record);
  el.recordDialog.close();
  await renderHistory();
}

async function exportData() {
  const list = await records.all();
  const payload = { app: APP_NAME, version: 1, exportedAt: new Date().toISOString(), records: list };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "林林时间-记录-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  el.settingsMessage.textContent = "已导出 " + list.length + " 条记录。";
}

async function importData(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || !Array.isArray(payload.records)) throw new Error("bad format");
    for (const record of payload.records) {
      if (record && typeof record.id === "string" && typeof record.eventName === "string") {
        await records.put(record);
      }
    }
    el.settingsMessage.textContent = "导入完成。";
    await renderHistory();
  } catch (error) {
    console.error(error);
    el.settingsMessage.textContent = "导入失败，请确认是正确的 JSON 备份。";
  }
}

async function clearAll() {
  if (!confirm("清空全部记录吗？这个操作不能撤销。")) return;
  await records.clear();
  el.settingsMessage.textContent = "记录已经清空。";
  await renderHistory();
}

function closeDialog(dialog) {
  if (dialog && typeof dialog.close === "function") dialog.close();
  else if (dialog) dialog.removeAttribute("open");
}

async function goHome() {
  stopTicker();
  document.title = APP_NAME + " · 极简事件计时器";
  showView(el.homeView);
  await renderHistory();
}

async function clearOldSiteCaches() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("quiet-timer-")).map((k) => caches.delete(k)));
    }
  } catch (error) {
    console.debug("cache cleanup skipped", error);
  }
}

async function init() {
  await clearOldSiteCaches();

  el.timerForm.addEventListener("submit", startTimer);
  el.pauseButton.addEventListener("click", togglePause);
  el.finishButton.addEventListener("click", () => {
    if (confirm("现在结束计时吗？这段时间会被记录。")) finishTimer();
  });
  el.completeHomeButton.addEventListener("click", goHome);

  el.historyList.addEventListener("click", handleHistoryClick);
  el.recordForm.addEventListener("submit", saveRecordEdit);
  el.closeRecordButton.addEventListener("click", () => closeDialog(el.recordDialog));
  el.cancelRecordButton.addEventListener("click", () => closeDialog(el.recordDialog));

  el.settingsButton.addEventListener("click", () => {
    el.settingsMessage.textContent = "";
    if (typeof el.settingsDialog.showModal === "function") el.settingsDialog.showModal();
    else el.settingsDialog.setAttribute("open", "");
  });
  el.closeSettingsButton.addEventListener("click", () => closeDialog(el.settingsDialog));
  el.exportButton.addEventListener("click", exportData);
  el.importInput.addEventListener("change", importData);
  el.clearButton.addEventListener("click", clearAll);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && activeTimer) updateClock();
  });
  window.addEventListener("pageshow", () => {
    if (activeTimer) updateClock();
  });

  try {
    await openDB();
    await renderHistory();
  } catch (error) {
    console.error(error);
  }

  activeTimer = loadActive();
  if (activeTimer) showTimer();
  else showView(el.homeView);
}

init().catch((error) => {
  console.error(error);
  if (el.formMessage) el.formMessage.textContent = "页面初始化失败，请刷新后再试。";
});
