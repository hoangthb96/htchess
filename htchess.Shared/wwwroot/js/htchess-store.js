export function save(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch {} }
export function load(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; } }
export function clear(key) { try { localStorage.removeItem(key); } catch {} }
