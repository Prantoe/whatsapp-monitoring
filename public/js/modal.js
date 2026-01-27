import { $ } from "./utils.js";

const $modal = $("confirmModal");
const $mTitle = $("confirmTitle");
const $mMsg = $("confirmMsg");
const $mOk = $("confirmOk");
const $mCancel = $("confirmCancel");

export function confirmModal({ title = "Konfirmasi", message = "Yakin?", confirmText = "Ya" }) {
  $mTitle.textContent = title;
  $mMsg.textContent = message;
  $mOk.textContent = confirmText;
  $modal.classList.remove("hidden");

  return new Promise((resolve) => {
    const cleanup = () => {
      $modal.classList.add("hidden");
      $mOk.removeEventListener("click", onOk);
      $mCancel.removeEventListener("click", onCancel);
      $modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onEsc);
    };
    const onOk = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onBackdrop = (e) => { if (e.target === $modal) onCancel(); };
    const onEsc = (e) => { if (e.key === "Escape") onCancel(); };

    $mOk.addEventListener("click", onOk);
    $mCancel.addEventListener("click", onCancel);
    $modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onEsc);
    $mOk.focus();
  });
}
