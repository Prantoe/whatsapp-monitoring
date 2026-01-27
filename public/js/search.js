import { digits, norm } from "./utils.js";

let currentQuery = "";

export function getCurrentQuery() {
  return currentQuery;
}

export function applySearch(columnsEl, qStr) {
  currentQuery = norm(qStr.trim());
  const qDigits = digits(currentQuery);

  const cards = Array.from(columnsEl.querySelectorAll(".colcard"));
  for (const card of cards) {
    const list = card.querySelector(".list");
    const colIdx = card.dataset.colsearch || "";
    const colMatch = currentQuery && (colIdx.includes(currentQuery) || (qDigits && colIdx.includes(qDigits)));

    if (!currentQuery) {
      card.classList.remove("hidden-col");
      Array.from(list.children).forEach((el) => el.classList.remove("hidden-search"));
      continue;
    }

    if (colMatch) {
      card.classList.remove("hidden-col");
      Array.from(list.children).forEach((el) => el.classList.remove("hidden-search"));
      continue;
    }

    let visibleCount = 0;
    Array.from(list.children).forEach((el) => {
      if (!el.classList.contains("msg")) return;
      const s = el.dataset.search || "";
      const match = s.includes(currentQuery) || (qDigits && s.includes(qDigits));
      el.classList.toggle("hidden-search", !match);
      if (match) visibleCount++;
    });

    card.classList.toggle("hidden-col", visibleCount === 0);
  }
}
