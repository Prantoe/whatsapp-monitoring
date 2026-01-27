import { $, esc, digits, norm } from "./utils.js";
import { confirmModal } from "./modal.js";

const apiStatus = $("apiStatus");
const totalRules = $("totalRules");

const reloadBtn = $("reloadRules");
const resetBtn = $("resetForm");
const saveBtn = $("saveRule");

// ✅ pakai field hidden buat PK phone lama (rename support)
const ruleId = $("ruleId"); // <-- ini sekarang isinya ORIGINAL phone (PK)
const phone = $("phone");
const trigger = $("trigger");
const threshold = $("threshold");

const q = $("q");
const tbody = $("rulesTbody");
const emptyState = $("emptyState");
const formMsg = $("formMsg");

let RULES = [];

function setChip(el, state) {
  el.textContent = state;
  el.classList.remove("chip--booting", "chip--ready", "chip--error");
  if (state === "ready") el.classList.add("chip--ready");
  else if (state === "error") el.classList.add("chip--error");
  else el.classList.add("chip--booting");
}

function toast(msg, ok = true) {
  formMsg.innerHTML = ok
    ? `<div class="chip chip--ready">${esc(msg)}</div>`
    : `<div class="chip chip--error">${esc(msg)}</div>`;
  setTimeout(() => (formMsg.innerHTML = ""), 2500);
}

async function api(path, init = {}) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || "Request failed");
  return json;
}

function normalizePhoneInput(v) {
  let s = String(v || "").trim();
  s = s.replace(/\D/g, "");
  if (s.startsWith("0")) s = "62" + s.slice(1);
  if (!s.startsWith("62") && s.startsWith("8")) s = "62" + s;
  return s;
}

function phoneKey(v) {
  return normalizePhoneInput(v);
}

function render() {
  const query = norm(q.value || "");
  const rows = RULES.filter((r) => {
    const hay = norm(`${r.phone} ${r.trigger} ${r.threshold} ${digits(r.phone)}`);
    return !query || hay.includes(query);
  });

  tbody.innerHTML = rows
    .map(
      (r) => `
    <tr data-id="${esc(r.phone)}" style="border-top: 1px solid rgba(255,255,255,.06);">
      <td style="padding:10px;"><code>${esc(r.phone)}</code></td>
      <td style="padding:10px; max-width: 520px;">${esc(r.trigger)}</td>
      <td style="padding:10px;"><code>${esc(String(r.threshold))}s</code></td>
      <td style="padding:10px;">
        <button class="btn btn-ghost btn-mini" data-act="edit">Edit</button>
        <button class="btn btn-danger btn-mini" data-act="del">Delete</button>
      </td>
    </tr>
  `
    )
    .join("");

  emptyState.style.display = rows.length ? "none" : "block";
  totalRules.textContent = String(RULES.length);
}

function fillForm(r) {
  // ✅ ruleId = ORIGINAL phone (PK)
  ruleId.value = r?.phone || "";
  phone.value = r?.phone || "";
  trigger.value = r?.trigger || "";
  threshold.value = r?.threshold ?? "";
}

function resetForm() {
  fillForm(null);
}

async function loadRules() {
  setChip(apiStatus, "booting");
  const json = await api("/api/rules");
  RULES = Array.isArray(json.data) ? json.data : [];
  setChip(apiStatus, "ready");
  render();
}

async function saveRule() {
  const originalPhone = phoneKey(ruleId.value || ""); // PK lama
  const nextPhone = phoneKey(phone.value);

  const payload = {
    phone: nextPhone,
    trigger: String(trigger.value || "").trim(),
    threshold: Number(threshold.value),
  };

  if (!payload.phone || !/^62\d{7,15}$/.test(payload.phone))
    return toast("Invalid phone", false);
  if (!payload.trigger) return toast("Trigger wajib diisi", false);
  if (!Number.isFinite(payload.threshold) || payload.threshold <= 0)
    return toast("Threshold harus > 0", false);

  // ✅ CREATE
  if (!originalPhone) {
    const json = await api("/api/rules", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    toast("Rule added");

    // replace kalau phone sudah ada (avoid duplicate UI)
    RULES = RULES.filter((x) => x.phone !== json.data.phone);
    RULES.unshift(json.data);

    resetForm();
    render();
    return;
  }

  // ✅ UPDATE (phone sama) -> PATCH
  if (originalPhone === nextPhone) {
    const json = await api(`/api/rules/${encodeURIComponent(originalPhone)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    toast("Rule updated");

    RULES = RULES.map((x) => (x.phone === originalPhone ? json.data : x));

    resetForm();
    render();
    return;
  }

  // ✅ RENAME (phone berubah) -> DELETE old + POST new (simple)
  await api(`/api/rules/${encodeURIComponent(originalPhone)}`, { method: "DELETE" });
  const json = await api("/api/rules", { method: "POST", body: JSON.stringify(payload) });

  toast("Rule updated (phone changed)");
  RULES = RULES.filter((x) => x.phone !== originalPhone && x.phone !== json.data.phone);
  RULES.unshift(json.data);

  resetForm();
  render();
}

async function deleteRule(phonePk) {
  const ok = await confirmModal({
    title: "Delete rule?",
    message: "Rule akan dihapus permanen.",
    confirmText: "Ya, hapus",
  });
  if (!ok) return;

  await api(`/api/rules/${encodeURIComponent(phonePk)}`, { method: "DELETE" });
  RULES = RULES.filter((x) => x.phone !== phonePk);
  toast("Rule deleted");
  render();
}

/* events */
reloadBtn.addEventListener("click", () => loadRules().catch((e) => toast(e.message, false)));
resetBtn.addEventListener("click", resetForm);
saveBtn.addEventListener("click", () => saveRule().catch((e) => toast(e.message, false)));
q.addEventListener("input", render);

tbody.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button");
  if (!btn) return;

  const tr = btn.closest("tr");
  const pk = tr?.getAttribute("data-id"); // ✅ phone
  if (!pk) return;

  const act = btn.getAttribute("data-act");
  const r = RULES.find((x) => x.phone === pk);

  if (act === "edit" && r) fillForm(r);
  if (act === "del") deleteRule(pk).catch((e) => toast(e.message, false));
});

/* init */
loadRules().catch((e) => {
  setChip(apiStatus, "error");
  toast(e.message, false);
});
