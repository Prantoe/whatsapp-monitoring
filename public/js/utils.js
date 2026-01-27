export function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id}`);
    return el;
  }
  
  export const esc = (s) =>
    String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  
  export const norm = (s) =>
    String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  
  export const digits = (s) => String(s || "").replace(/\D/g, "");
  