import { $ } from "./utils.js";
import { confirmModal } from "./modal.js";
import { createWs } from "./ws.js";
import { createColumns } from "./columns.js";
import { applySearch } from "./search.js";
import {
  bindFullscreenHotkey,
  bindLogout,
  hideLogout,
  hideQR,
  renderQR,
  setMe,
  setStatus,
  showLogout,
  showQR,
  updateLogoutButton,
  getLogoutButton,
  isLogoutInProgress,
  markLogoutInProgress,
  restoreLogoutButton,
} from "./ui.js";

const columnsEl = $("columns");
const searchInput = $("search");
const clearAllBtn = $("clearAll");
const exportAllBtn = $("exportAll");
const broadcastBtn = $("broadcast");

const cols = createColumns(columnsEl);
const { ws, sendCmd } = createWs();

/* ================== INIT ================== */
bindFullscreenHotkey();
bindLogout(onLogout);

searchInput.addEventListener("input", (e) => {
  applySearch(columnsEl, e.target.value || "");
});

clearAllBtn.addEventListener("click", onClearAll);
broadcastBtn?.addEventListener("click", onBroadcast);

/* ================== COLUMN EVENTS ================== */
columnsEl.addEventListener("click", async (ev) => {
  const clearBtn = ev.target.closest(".clear-col");
  if (!clearBtn) return;

  const clientId = clearBtn.getAttribute("data-clientid");
  if (!clientId) return;

  const label =
    clearBtn.closest(".colcard")?.querySelector("h4")?.textContent || clientId;

  const ok = await confirmModal({
    title: `Clear kolom "${label}"?`,
    message: "Semua pesan pada kolom ini akan dihapus.",
    confirmText: "Ya, hapus kolom ini",
  });
  if (!ok) return;

  cols.clearSlaAlert?.(clientId);
  sendCmd("clear_client", { clientId });
});

/* ================== WS LIFECYCLE ================== */
ws.addEventListener("open", () => updateLogoutButton("ready"));
ws.addEventListener("close", () => updateLogoutButton("booting"));
ws.addEventListener("error", () => updateLogoutButton("booting"));

/** batch UI ops biar rule_seed banyak gak bikin UI “keliatan ngaco” */
let seedDirty = false;
function flushSeedUI() {
  if (!seedDirty) return;
  seedDirty = false;
  cols.sortColumns();
  applySearch(columnsEl, searchInput.value || "");
  refreshActionsVisibility();
}
function markSeedDirty() {
  if (seedDirty) return;
  seedDirty = true;
  requestAnimationFrame(flushSeedUI);
}

ws.onmessage = async (ev) => {
  const { type, data } = JSON.parse(ev.data);

  // NOTE: ini event bisa spam (per rule), jadi jangan heavy work tiap event.
  if (type === "rule_seed") {
    console.log("[ui] rule_seed", data);
    cols.ensureCol(data.clientId, data.clientLabel, data.clientPhone || "", { seeded: true });

    cols.sortColumns();
    applySearch(columnsEl, searchInput.value || "");
    refreshActionsVisibility();
    return;
  }

  if (type === "rename_col") {
    cols.renameCol?.(data.clientId, data.label);
    return;
  }
  
  

  switch (type) {
    case "status":
      onStatus(data);
      return;

    case "alert":
      onAlert(data);
      return;

    case "qr":
      await onQr(data);
      return;

    case "message":
      onMessage(data);
      return;

    case "messages":
      onMessages(data);
      return;

    case "cleared":
      onCleared(data);
      return;

    default:
      return;
  }
};

/* ================== WS HANDLERS ================== */
function onStatus(data) {
  setStatus(data.state);
  setMe(data.me || "-");
  updateLogoutButton(data.state);

  if (data.state === "scan_qr") {
    showQR();
    const qrbox = $("qrbox");
    if (qrbox && !qrbox.firstChild) qrbox.innerHTML = "<span>Loading QR…</span>";
    hideLogout();
  } else if (data.state === "ready" || data.state === "authenticated") {
    hideQR();
    showLogout();
  } else {
    hideQR();
    hideLogout();
  }

  if (data.state === "booting" || data.state === "disconnected") {
    markLogoutInProgress(false);
  }
}

function onAlert(data) {
  // race-safe: kalau alert datang duluan, bikin kolomnya dulu.
  cols.ensureCol(data.clientId, data.clientId, "");
  cols.markSlaAlert(
    data.clientId,
    data.reason === "NO_RESPONSE"
      ? "No response (SLA breached)"
      : `Late response (${Math.round(data.gap)}s > ${data.threshold}s)`
  );
}

async function onQr(data) {
  await renderQR(data.qr);
  hideLogout();
}

function onMessage(data) {
  cols.renderMsgIntoColumn(data);
  applySearch(columnsEl, searchInput.value || "");
  refreshActionsVisibility();
}

function onMessages(data) {
  if (!Array.isArray(data)) return;

  data.forEach((m) => cols.renderMsgIntoColumn(m));

  cols.sortColumns();
  applySearch(columnsEl, searchInput.value || "");
  refreshActionsVisibility();

  columnsEl.querySelectorAll(".list").forEach((list) => {
    cols.updateEmptyState(list);
  });
}

function onCleared(data) {
  if (data.scope === "all") {
    cols.colMap.clear();
    columnsEl.innerHTML = "";
    clearAllBtn.disabled = false;
    clearAllBtn.textContent = "Clear All";
    searchInput.value = "";
    applySearch(columnsEl, "");
    refreshActionsVisibility();
    return;
  }

  if (data.scope === "client") {
    cols.removeColumnById(String(data.clientId));
    refreshActionsVisibility();
  }
}

/* ================== ACTIONS ================== */
async function onLogout() {
  const logoutBtn = getLogoutButton();
  if (!logoutBtn || isLogoutInProgress()) return;

  const ok = await confirmModal({
    title: "Yakin ingin keluar?",
    message: "Tindakan ini akan menghilangkan koneksi WhatsApp.",
    confirmText: "Ya, Keluar",
  });
  if (!ok) return;

  markLogoutInProgress(true);

  const prev = logoutBtn.textContent;
  logoutBtn.disabled = true;
  logoutBtn.textContent = "Logging out…";

  const safety = setTimeout(() => restoreLogoutButton(prev), 8000);

  try {
    const sent = sendCmd("logout");
    if (!sent) {
      clearTimeout(safety);
      restoreLogoutButton(prev);
    }
  } catch {
    clearTimeout(safety);
    restoreLogoutButton(prev);
  }
}

async function onClearAll() {
  const ok = await confirmModal({
    title: "Clear semua pesan?",
    message: "Tindakan ini akan menghapus semua pesan dari semua kolom.",
    confirmText: "Ya, hapus semua",
  });
  if (!ok) return;

  clearAllBtn.disabled = true;
  clearAllBtn.textContent = "Clearing…";

  sendCmd("clear_all");

  setTimeout(() => {
    if (clearAllBtn.disabled) {
      clearAllBtn.disabled = false;
      clearAllBtn.textContent = "Clear All";
    }
  }, 3000);
}

async function onBroadcast() {
  const ok = await confirmModal({
    title: "Broadcast trigger?",
    message: "Pesan akan dikirim ke semua nomor rule.",
    confirmText: "Ya, kirim",
  });
  if (!ok) return;

  sendCmd("broadcast");
}

function refreshActionsVisibility() {
  const hasAnyMessage = !!columnsEl.querySelector(".list .msg");
  clearAllBtn.classList.toggle("hidden", !hasAnyMessage);
  exportAllBtn.classList.toggle("hidden", !hasAnyMessage);
}
