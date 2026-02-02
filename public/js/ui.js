import { $ } from "./utils.js";
import { toCanvas } from "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm";

const statusEl = $("status");
const meEl = $("me");
const qrBox = $("qrbox");
const logoutBtn = $("logout");

const PRETTY = {
  booting: "booting",
  scan_qr: "scan QR",
  authenticated: "authenticated",
  ready: "ready",
  disconnected: "disconnected",
  auth_failure: "auth_failure",
};
const STATE_CLASS = {
  booting: "chip chip--booting",
  scan_qr: "chip chip--scan_qr",
  authenticated: "chip chip--authenticated",
  ready: "chip chip--ready",
  disconnected: "chip chip--disconnected",
  auth_failure: "chip chip--auth_failure",
};

let isLoggingOut = false;

export function setStatus(state) {
  statusEl.className = STATE_CLASS[state] || STATE_CLASS.booting;
  statusEl.textContent = PRETTY[state] || state;
}

export function setMe(me) {
  meEl.textContent = me || "-";
}

export async function renderQR(qr) {
  showQR();
  qrBox.innerHTML = "";
  const canvas = document.createElement("canvas");
  await toCanvas(canvas, qr, { width: 300, margin: 1 });
  qrBox.appendChild(canvas);
}

export function showQR() {
  qrBox.classList.remove("hidden");
  hideLogout();
}
export function hideQR() {
  qrBox.classList.add("hidden");
  qrBox.innerHTML = "";
}

export function showLogout() {
  logoutBtn.classList.remove("hidden");
}
export function hideLogout() {
  logoutBtn.classList.add("hidden");
}

export function updateLogoutButton(state) {
  logoutBtn.disabled = state === "booting";
  logoutBtn.textContent = logoutBtn.disabled ? "Logging out…" : "⏻ Logout";
}

export function bindFullscreenHotkey() {
  document.addEventListener("keydown", (e) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const isF = e.key.toLowerCase() === "f";
    if ((isMac && e.metaKey && isF) || (!isMac && e.ctrlKey && isF)) {
      e.preventDefault();
      const elem = document.documentElement;
      elem.requestFullscreen?.() || elem.webkitRequestFullscreen?.() || elem.msRequestFullscreen?.();
    }
  });
}

export function bindLogout(onLogout) {
  logoutBtn.addEventListener("click", onLogout);
}

export function markLogoutInProgress(v) {
  isLoggingOut = v;
}
export function isLogoutInProgress() {
  return isLoggingOut;
}
export function restoreLogoutButton(prevLabel) {
  isLoggingOut = false;
  logoutBtn.disabled = false;
  logoutBtn.textContent = prevLabel || "Logout";
}
export function getLogoutButton() {
  return logoutBtn;
}
