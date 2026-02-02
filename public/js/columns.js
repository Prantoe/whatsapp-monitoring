// public/columns.js
import { esc, digits, norm } from "./utils.js";
import { getCurrentQuery } from "./search.js";

export function createColumns(columnsEl) {
  const colMap = new Map(); // clientId -> list element

  const buildColIndex = (label, phone, key) => {
    const p = String(phone || "");
    return [norm(label), norm(p), String(key || "").toLowerCase(), digits(p)]
      .filter(Boolean)
      .join(" ");
  };

  const buildMsgIndex = (m) => {
    const parts = [
      m.body,
      m.name,
      m.clientLabel,
      m.clientPhone,
      m.clientId,
    ].map((x) => norm(x || ""));
    parts.push(digits(m.clientPhone || ""));
    return parts.join(" ");
  };

  function ensureCol(clientId, label, phone, opts = {}) {
    const key = String(clientId || "").trim();
    if (!key) return null;

    if (colMap.has(key))
      return { list: colMap.get(key), card: getCardByKey(key) };

    const card = document.createElement("div");
    card.className = "colcard";

    // seeded = kolom dari rules.txt
    if (opts.seeded) card.dataset.seeded = "1";

    card.innerHTML = `
      <div class="col-head">
        <div class="col-title">
        <div class="wa-title">
                <span class="wa-dot wa-dot--unknown"></span>
                <h4>${esc(label || key)}</h4>
              </div>          ${
                phone
                  ? `<div class="subtitle"><code>${esc(phone)}</code></div>`
                  : ""
              }
        </div>
        <div class="col-actions">
          <a class="btn btn-export btn-ghost btn-mini"
             href="export.csv?client=${encodeURIComponent(key)}"
             download>Export</a>
          <button class="btn btn-ghost btn-mini clear-col" data-clientid="${esc(
            key
          )}">Clear</button>
        </div>
      </div>

<div class="col-activity hidden">
  <div class="last-out">Last out: —</div>
  <div class="last-in">Last in: —</div>
</div>

      <div class="list"></div>

      <div class="col-sticky hidden" data-clientid="${esc(key)}">
        <span class="stat"></span>
      </div>
    `;

    card.dataset.colsearch = buildColIndex(label || key, phone || "", key);
    columnsEl.appendChild(card);

    const list = card.querySelector(".list");
    if (!list) {
      console.warn("[ui] list missing for", key, card);
      return null;
    }

    colMap.set(key, list);
    sortColumns();
    return { list, card };
  }

  function getCardByKey(key) {
    const list = colMap.get(String(key));
    return list?.closest?.(".colcard") || null;
  }

  function setupClamp(container) {
    const body = container.querySelector(".body");
    const btn = container.querySelector(".readmore");

    requestAnimationFrame(() => {
      if (body && btn && body.scrollHeight > body.clientHeight + 2) {
        btn.classList.remove("hidden");
      }
    });

    btn?.addEventListener("click", () => {
      const expanded = body.classList.toggle("expanded");
      btn.textContent = expanded ? "Closed" : "Read More";
      btn.setAttribute("aria-expanded", String(expanded));
    });
  }

  function updateEmptyState(list) {
    const card = list?.closest?.(".colcard");
    if (!card) return;

    let empty = card.querySelector(".empty");
    if (!empty) {
      empty = document.createElement("div");
      empty.className = "empty";
      card.appendChild(empty);
    }

    const total = list.querySelectorAll(".msg").length;
    if (total === 0) {
      empty.textContent = "No messages";
      empty.classList.add("show");
      return;
    }

    const q = getCurrentQuery();
    const hasVisible = Array.from(list.querySelectorAll(".msg")).some(
      (el) => !el.classList.contains("hidden-search")
    );

    if (!hasVisible && q && !card.classList.contains("hidden-col")) {
      empty.textContent = "No results";
      empty.classList.add("show");
    } else {
      empty.classList.remove("show");
    }
  }

  function renderMsgIntoColumn(m) {
    const id = String(m?.clientId || "").trim();
    const label = m?.clientLabel || id || "UNKNOWN";
    const phone = m?.clientPhone || "";

    const ensured = ensureCol(id || label, label, phone);
    if (!ensured) return;

    const { list } = ensured;

    const ts = typeof m.ts === "number" ? m.ts : Date.now();
    const d = new Date(ts);
    const dir = m.direction === "out" ? "out" : "in";

    const div = document.createElement("div");
    div.className = `msg msg--${dir}`;
    div.dataset.search = buildMsgIndex(m);

    // div.innerHTML = `
    //   <div class="msg__bubble">
    //     <div class="msg__meta"><span class="ts">${d.toLocaleString("id-ID")}</span></div>
    //     <div class="sender">${esc(m.name || "")}</div>
    //     <div class="body">${esc(m.body || "").replace(/\n/g, "<br>")}</div>
    //     <button type="button" class="readmore hidden" aria-expanded="false">Baca lengkap</button>
    //   </div>
    // `;

    list.prepend(div);
    setupClamp(div);

    // apply current search to new msg
    const q = getCurrentQuery();
    if (q) {
      const qDigits = digits(q);
      const s = div.dataset.search || "";
      const hit = s.includes(q) || (qDigits && s.includes(qDigits));
      div.classList.toggle("hidden-search", !hit);
    }
    updateActivity(id, dir === "out" ? "out" : "in", ts);

    updateEmptyState(list);
  }

  function sortColumns() {
    const cards = Array.from(columnsEl.querySelectorAll(".colcard"));
    cards.sort((a, b) => {
      const ta = (a.querySelector("h4")?.textContent || "").toUpperCase();
      const tb = (b.querySelector("h4")?.textContent || "").toUpperCase();
      return ta.localeCompare(tb, "id-ID", { sensitivity: "base" });
    });
    cards.forEach((el) => columnsEl.appendChild(el));
  }

  function removeColumnById(clientId) {
    const key = String(clientId || "");
    const list = colMap.get(key);
    if (!list) return;
    list.closest(".colcard")?.remove();
    colMap.delete(key);
    sortColumns();
  }

  function markSlaAlert(clientId, reason = "SLA breach") {
    const key = String(clientId || "");
    const list = colMap.get(key);
    if (!list) return;

    const card = list.closest(".colcard");
    const sticky = card?.querySelector(".col-sticky");
    const stat = sticky?.querySelector(".stat");
    if (!sticky || !stat) return;

    sticky.classList.remove("hidden");
    sticky.classList.add("sla");
    stat.innerHTML = `⚠ ${esc(reason)}`;
    setColStatus(clientId, "red");
  }

  function clearSlaAlert(clientId) {
    const key = String(clientId || "");
    const list = colMap.get(key);
    if (!list) return;

    const card = list.closest(".colcard");
    const sticky = card?.querySelector(".col-sticky");
    const stat = sticky?.querySelector(".stat");
    if (!sticky || !stat) return;

    sticky.classList.add("hidden");
    sticky.classList.remove("sla");
    stat.textContent = "";
  }

  function renameCol(clientId, label) {
    const list = colMap.get(String(clientId));
    const card = list?.closest(".colcard");
    const h4 = card?.querySelector("h4");
    if (!h4 || !label) return;

    h4.textContent = label;
  }

  function setColStatus(clientId, status) {
    const list = colMap.get(String(clientId));
    const dot = list?.closest(".colcard")?.querySelector(".wa-dot");
    if (!dot) return;

    console.log("[setColStatus]", clientId, status); // 👈 cek ini

    dot.className = "wa-dot"; // reset dulu
    dot.classList.add(`wa-dot--${status}`);
  }

  const lastActivity = new Map(); // clientId -> { in?: ts, out?: ts }

  function updateActivity(clientId, dir, ts) {
    const card = getCardByKey(clientId);
    if (!card) return;
  
    const act = lastActivity.get(clientId) || {};
    act[dir] = ts;
    lastActivity.set(clientId, act);
  
    const box = card.querySelector(".col-activity");
    if (!box) return;
  
    box.classList.remove("hidden");
  
    const outEl = box.querySelector(".last-out");
    const inEl  = box.querySelector(".last-in");
    if (!outEl || !inEl) return;
  
    const fmt = (t) =>
      new Date(t).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
  
    outEl.textContent = act.out
      ? `Last outbound: ${fmt(act.out)}`
      : "Last outbound: —";
  
    inEl.textContent = act.in
      ? `Last inbound : ${fmt(act.in)}`
      : "Last inbound : —";
  }
  

  return {
    colMap,
    ensureCol,
    renderMsgIntoColumn,
    sortColumns,
    removeColumnById,
    updateEmptyState,
    markSlaAlert,
    clearSlaAlert,
    renameCol,
    setColStatus,
    updateActivity,
  };
}
