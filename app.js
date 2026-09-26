"use strict";

// 最常改的内容都集中在这里：标题、快捷时长、图片路径和数据版本。
const CONFIG = {
  appName: "林林时间",
  durationOptions: [15, 25, 45, 60],
  defaultMinutes: 25,
  imagePaths: {
    source: "./images/home-visual.jpg",
    person: "./images/person-mark.png",
    cat: "./images/cat-mark.png",
  },
  dbName: "quiet-timer-db",
  dbVersion: 1,
  storeName: "records",
  activeTimerKey: "quiet-timer-active",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  views: $$(".view"),
  homeView: $("#homeView"),
  timerView: $("#timerView"),
  completeView: $("#completeView"),
  timerForm: $("#timerForm"),
  eventName: $("#eventName"),
  location: $("#location"),
  customMinutes: $("#customMinutes"),
  durationOptions: $("#durationOptions"),
  recentEvents: $("#recentEvents"),
  recentLocations: $("#recentLocations"),
  formMessage: $("#formMessage"),
  historyList: $("#historyList"),
  emptyHistory: $("#emptyHistory"),
  recordCount: $("#recordCount"),
  timerEventName: $("#timerEventName"),
  timerLocation: $("#timerLocation"),
  countdown: $("#countdown"),
  timerStatus: $("#timerStatus"),
  pauseButton: $("#pauseButton"),
  finishEarlyButton: $("#finishEarlyButton"),
  completeSummary: $("#completeSummary"),
  completeHomeButton: $("#completeHomeButton"),
  recordDialog: $("#recordDialog"),
  recordForm: $("#recordForm"),
  closeRecordButton: $("#closeRecordButton"),
  cancelRecordButton: $("#cancelRecordButton"),
  editRecordId: $("#editRecordId"),
  editEventName: $("#editEventName"),
  editLocation: $("#editLocation"),
  saveRecordButton: $("#saveRecordButton"),
  settingsDialog: $("#settingsDialog"),
  settingsButton: $("#settingsButton"),
  closeSettingsButton: $("#closeSettingsButton"),
  exportButton: $("#exportButton"),
  importInput: $("#importInput"),
  clearButton: $("#clearButton"),
  settingsMessage: $("#settingsMessage"),
};

let dbPromise;
let activeTimer = null;
let ticker = null;
let selectedMinutes = CONFIG.defaultMinutes;
let audioContext = null;
let isCompleting = false;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CONFIG.dbName, CONFIG.dbVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONFIG.storeName)) {
        const store = db.createObjectStore(CONFIG.storeName, { keyPath: "id" });
        store.createIndex("endTime", "endTime");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function runStore(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CONFIG.storeName, mode);
    const store = transaction.objectStore(CONFIG.storeName);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const recordStore = {
  all: async () => {
    const records = await runStore("readonly", (store) => store.getAll());
    return records.sort((a, b) => b.endTime - a.endTime);
  },
  get: (id) => runStore("readonly", (store) => store.get(id)),
  put: (record) => runStore("readwrite", (store) => store.put(record)),
  delete: (id) => runStore("readwrite", (store) => store.delete(id)),
  clear: () => runStore("readwrite", (store) => store.clear()),
};

function saveActiveTimer() {
  if (activeTimer) localStorage.setItem(CONFIG.activeTimerKey, JSON.stringify(activeTimer));
  else localStorage.removeItem(CONFIG.activeTimerKey);
}

function loadActiveTimer() {
  try {
    const value = JSON.parse(localStorage.getItem(CONFIG.activeTimerKey));
    if (!value || !value.id || !value.eventName || !Number.isFinite(value.targetEndTime)) return null;
    return value;
  } catch {
    localStorage.removeItem(CONFIG.activeTimerKey);
    return null;
  }
}

function showView(view) {
  elements.views.forEach((item) => {
    const active = item === view;
    item.hidden = !active;
    item.classList.toggle("view--active", active);
  });
  window.scrollTo({ top: 0, behavior: "auto" });
}

function formatRemaining(milliseconds) {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getRemaining() {
  if (!activeTimer) return 0;
  return activeTimer.paused
    ? Math.max(0, activeTimer.remainingAtPause || 0)
    : Math.max(0, activeTimer.targetEndTime - Date.now());
}

function updateTimerDisplay() {
  if (!activeTimer) return;
  const remaining = getRemaining();
  elements.countdown.textContent = formatRemaining(remaining);
  document.title = `${formatRemaining(remaining)} · ${activeTimer.eventName}`;
  if (!activeTimer.paused && remaining <= 0) completeTimer("完成");
}

function startTicker() {
  clearInterval(ticker);
  updateTimerDisplay();
  ticker = window.setInterval(updateTimerDisplay, 500);
}

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `timer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function unlockAudio() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    audioContext ||= new AudioCtx();
    if (audioContext.state === "suspended") audioContext.resume();
  } catch { /* 自动降级 */ }
}

function playFinishSound() {
  try {
    unlockAudio();
    if (!audioContext) return;
    const now = audioContext.currentTime;
    [0, 0.22].forEach((offset) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(offset ? 660 : 520, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      oscillator.connect(gain).connect(audioContext.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.2);
    });
  } catch { /* 自动降级 */ }
}

async function requestNotificationPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch { /* 自动降级 */ }
}

async function notifyFinished(timer) {
  playFinishSound();
  try { navigator.vibrate?.([120, 80, 120]); } catch { /* 自动降级 */ }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const body = `${timer.eventName} · ${timer.plannedMinutes}分钟完成`;
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration?.showNotification) {
      await registration.showNotification("时间到了", { body, icon: "./icons/icon-192.png", badge: "./icons/icon-192.png" });
    } else {
      new Notification("时间到了", { body });
    }
  } catch {
    try { new Notification("时间到了", { body }); } catch { /* 自动降级 */ }
  }
}

function showTimerView() {
  if (!activeTimer) return;
  elements.timerView.classList.toggle("is-paused", activeTimer.paused);
  elements.timerEventName.textContent = activeTimer.eventName;
  elements.timerLocation.textContent = activeTimer.location ? `在 ${activeTimer.location}` : "";
  elements.pauseButton.textContent = activeTimer.paused ? "继续" : "暂停";
  elements.timerStatus.textContent = activeTimer.paused ? "先停在这里" : "正在计时";
  showView(elements.timerView);
  startTicker();
}

async function startTimer(event) {
  event.preventDefault();
  const eventName = elements.eventName.value.trim();
  const location = elements.location.value.trim();
  const customValue = Number.parseInt(elements.customMinutes.value, 10);
  const minutes = elements.customMinutes.value ? customValue : selectedMinutes;

  if (!eventName) {
    elements.formMessage.textContent = "先写下要做的事。";
    elements.eventName.focus();
    return;
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    elements.formMessage.textContent = "时间请填写 1 到 1440 分钟。";
    elements.customMinutes.focus();
    return;
  }

  elements.formMessage.textContent = "";
  const now = Date.now();
  activeTimer = {
    id: createId(),
    eventName,
    location,
    startTime: now,
    targetEndTime: now + minutes * 60_000,
    plannedMinutes: minutes,
    paused: false,
    remainingAtPause: null,
    pauseStartedAt: null,
    totalPausedMs: 0,
  };
  saveActiveTimer();
  unlockAudio();
  void requestNotificationPermission();
  showTimerView();
}

function togglePause() {
  if (!activeTimer) return;
  if (activeTimer.paused) {
    const now = Date.now();
    activeTimer.totalPausedMs += Math.max(0, now - activeTimer.pauseStartedAt);
    activeTimer.targetEndTime = now + activeTimer.remainingAtPause;
    activeTimer.paused = false;
    activeTimer.pauseStartedAt = null;
    activeTimer.remainingAtPause = null;
  } else {
    activeTimer.remainingAtPause = getRemaining();
    activeTimer.paused = true;
    activeTimer.pauseStartedAt = Date.now();
  }
  saveActiveTimer();
  showTimerView();
}

async function completeTimer(status) {
  if (!activeTimer || isCompleting) return;
  isCompleting = true;
  stopTicker();
  const timer = { ...activeTimer };
  const now = Date.now();
  const activeElapsed = Math.max(0, now - timer.startTime - (timer.totalPausedMs || 0) - (timer.paused ? Math.max(0, now - timer.pauseStartedAt) : 0));
  const actualMinutes = status === "完成"
    ? timer.plannedMinutes
    : Math.max(0, Math.round(activeElapsed / 60_000));
  const record = {
    id: timer.id,
    eventName: timer.eventName,
    location: timer.location,
    startTime: timer.startTime,
    endTime: status === "完成" ? Math.min(now, timer.targetEndTime) : now,
    plannedMinutes: timer.plannedMinutes,
    actualMinutes,
    status,
  };

  try {
    await recordStore.put(record);
    activeTimer = null;
    saveActiveTimer();
    document.title = `${CONFIG.appName} · 极简事件计时器`;
    elements.completeSummary.textContent = status === "完成"
      ? `${record.eventName} · ${record.plannedMinutes}分钟`
      : `${record.eventName} · 提前收尾，实际 ${record.actualMinutes}分钟`;
    showView(elements.completeView);
    if (status === "完成") void notifyFinished(timer);
  } catch (error) {
    console.error(error);
    elements.timerStatus.textContent = "记录暂时没有保存，请再试一次";
    startTicker();
  } finally {
    isCompleting = false;
  }
}

async function goHome() {
  stopTicker();
  document.title = `${CONFIG.appName} · 极简事件计时器`;
  showView(elements.homeView);
  await renderHistory();
}

function groupLabel(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const difference = Math.round((startToday - startDate) / 86_400_000);
  if (difference === 0) return "今天";
  if (difference === 1) return "昨天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function renderHistory() {
  try {
    const records = await recordStore.all();
    elements.recordCount.textContent = records.length ? `${records.length} 条` : "";
    elements.emptyHistory.hidden = records.length > 0;
    elements.historyList.innerHTML = "";
    const groups = new Map();
    records.forEach((record) => {
      const label = groupLabel(record.endTime);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(record);
    });

    groups.forEach((items, label) => {
      const group = document.createElement("section");
      group.className = "history-group";
      group.innerHTML = `<h3 class="history-group-title">${escapeHtml(label)}</h3>`;
      items.forEach((record) => {
        const date = new Date(record.endTime);
        const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
        const minutes = record.status === "完成" ? record.plannedMinutes : record.actualMinutes;
        const meta = [record.location, `${minutes}分钟`, record.status === "提前结束" ? "提前结束" : ""].filter(Boolean).join(" · ");
        const row = document.createElement("article");
        row.className = "record-row";
        row.innerHTML = `
          <time class="record-time" datetime="${new Date(record.endTime).toISOString()}">${escapeHtml(time)}</time>
          <div class="record-main"><strong>${escapeHtml(record.eventName)}</strong><span>${escapeHtml(meta)}</span></div>
          <div class="record-actions">
            <button class="record-action" type="button" data-action="edit" data-id="${escapeHtml(record.id)}">修改</button>
            <button class="record-action record-action--delete" type="button" data-action="delete" data-id="${escapeHtml(record.id)}">删除</button>
          </div>`;
        group.append(row);
      });
      elements.historyList.append(group);
    });
    renderRecentChoices(records);
  } catch (error) {
    console.error(error);
    elements.emptyHistory.hidden = false;
    elements.emptyHistory.querySelector("p").textContent = "暂时读不到记录";
  }
}

function renderRecentChoices(records) {
  const unique = (key) => [...new Set(records.map((record) => record[key]?.trim()).filter(Boolean))].slice(0, 4);
  const render = (container, values, input) => {
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
      container.append(button);
    });
  };
  render(elements.recentEvents, unique("eventName"), elements.eventName);
  render(elements.recentLocations, unique("location"), elements.location);
}

async function handleHistoryClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const record = await recordStore.get(button.dataset.id);
  if (!record) return;
  if (button.dataset.action === "edit") {
    elements.editRecordId.value = record.id;
    elements.editEventName.value = record.eventName;
    elements.editLocation.value = record.location || "";
    elements.recordDialog.showModal();
  }
  if (button.dataset.action === "delete") {
    if (!confirm(`删除“${record.eventName}”这条记录吗？`)) return;
    await recordStore.delete(record.id);
    await renderHistory();
  }
}

async function saveRecordEdit(event) {
  event.preventDefault();
  const name = elements.editEventName.value.trim();
  if (!name) {
    elements.editEventName.focus();
    return;
  }
  const record = await recordStore.get(elements.editRecordId.value);
  if (!record) return;
  await recordStore.put({ ...record, eventName: name, location: elements.editLocation.value.trim() });
  elements.recordDialog.close();
  await renderHistory();
}

async function exportData() {
  const records = await recordStore.all();
  const payload = { app: CONFIG.appName, version: 1, exportedAt: new Date().toISOString(), records };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `林林时间-记录-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  elements.settingsMessage.textContent = `已导出 ${records.length} 条记录。`;
}

function isValidRecord(record) {
  return record && typeof record.id === "string" && typeof record.eventName === "string" &&
    Number.isFinite(record.startTime) && Number.isFinite(record.endTime) &&
    Number.isFinite(record.plannedMinutes) && Number.isFinite(record.actualMinutes) &&
    ["完成", "提前结束"].includes(record.status);
}

async function importData(event) {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!payload || payload.version !== 1 || !Array.isArray(payload.records) || !payload.records.every(isValidRecord)) {
      throw new Error("格式不正确");
    }
    for (const record of payload.records) await recordStore.put(record);
    elements.settingsMessage.textContent = `已导入 ${payload.records.length} 条记录。`;
    await renderHistory();
  } catch {
    elements.settingsMessage.textContent = "这个文件不像“林林时间”的备份，请换一个。";
  }
}

async function clearAllData() {
  if (!confirm("清空全部记录吗？这个操作不能撤销。")) return;
  await recordStore.clear();
  elements.settingsMessage.textContent = "记录已经清空。";
  await renderHistory();
}

function setupDurationOptions() {
  const chips = $$(".duration-chip");
  chips.forEach((chip) => chip.addEventListener("click", () => {
    selectedMinutes = Number(chip.dataset.minutes);
    elements.customMinutes.value = "";
    chips.forEach((item) => item.classList.toggle("duration-chip--selected", item === chip));
  }));
  elements.customMinutes.addEventListener("input", () => chips.forEach((chip) => chip.classList.remove("duration-chip--selected")));
}

function setupVisualAssets() {
  document.documentElement.style.setProperty("--person-art", `url("${CONFIG.imagePaths.person}")`);
  document.documentElement.style.setProperty("--cat-art", `url("${CONFIG.imagePaths.cat}")`);
  $$('[data-hide-on-error] img').forEach((image) => {
    image.addEventListener("error", () => image.closest("[data-hide-on-error]")?.remove());
  });
}

function registerWebMCPTools() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  try {
    void Promise.resolve(context.registerTool({
      name: "start_timer",
      title: "开始计时",
      description: "为一个事件开始本地倒计时，并在页面中显示计时状态。",
      inputSchema: {
        type: "object",
        properties: {
          eventName: { type: "string", minLength: 1, maxLength: 60 },
          location: { type: "string", maxLength: 60 },
          minutes: { type: "integer", minimum: 1, maximum: 1440 },
        },
        required: ["eventName", "minutes"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input.eventName !== "string" || !input.eventName.trim() || !Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 1440) {
          throw new Error("事件名称或分钟数无效");
        }
        elements.eventName.value = input.eventName.trim();
        elements.location.value = typeof input.location === "string" ? input.location.trim() : "";
        elements.customMinutes.value = input.minutes;
        elements.timerForm.requestSubmit();
        return { status: "started", eventName: input.eventName.trim(), minutes: input.minutes };
      },
    }));
  } catch (error) { console.debug("WebMCP unavailable", error); }
}

async function init() {
  setupDurationOptions();
  setupVisualAssets();
  elements.timerForm.addEventListener("submit", startTimer);
  elements.pauseButton.addEventListener("click", togglePause);
  elements.finishEarlyButton.addEventListener("click", () => {
    if (confirm("现在提前结束吗？这段时间仍会被记录。")) void completeTimer("提前结束");
  });
  elements.completeHomeButton.addEventListener("click", goHome);
  elements.historyList.addEventListener("click", handleHistoryClick);
  elements.recordForm.addEventListener("submit", saveRecordEdit);
  elements.closeRecordButton.addEventListener("click", () => elements.recordDialog.close());
  elements.cancelRecordButton.addEventListener("click", () => elements.recordDialog.close());
  elements.settingsButton.addEventListener("click", () => {
    elements.settingsMessage.textContent = "";
    elements.settingsDialog.showModal();
  });
  elements.closeSettingsButton.addEventListener("click", () => elements.settingsDialog.close());
  elements.exportButton.addEventListener("click", exportData);
  elements.importInput.addEventListener("change", importData);
  elements.clearButton.addEventListener("click", clearAllData);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && activeTimer) updateTimerDisplay();
  });
  window.addEventListener("pageshow", () => { if (activeTimer) updateTimerDisplay(); });

  try { await openDatabase(); } catch (error) { console.error(error); }
  await renderHistory();
  activeTimer = loadActiveTimer();
  if (activeTimer) {
    if (!activeTimer.paused && activeTimer.targetEndTime <= Date.now()) await completeTimer("完成");
    else showTimerView();
  } else {
    showView(elements.homeView);
  }
  registerWebMCPTools();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(console.error));
}

void init();
