// MSK trading checklist: defaults and scoring. Shared by the app, the extension and the main process.
(function (root) {
  const DEFAULT = {
    enabled: false,
    title: "Pre-trade checklist",
    items: [
      { id: "htf", text: "Higher-timeframe bias agrees", pts: 2 },
      { id: "liq", text: "Liquidity taken first", pts: 2 },
      { id: "mss", text: "Clear shift in structure", pts: 2 },
      { id: "lvl", text: "Entry at a key level", pts: 1 },
      { id: "ses", text: "Inside my trading session", pts: 1 },
      { id: "news", text: "No big news in the next 30 min", pts: 1 },
      { id: "risk", text: "Stop set, risk within my limit", pts: 1 },
      { id: "rr", text: "Target gives at least 2R", pts: 1 },
    ],
    checked: [],
    checkedDay: "",
    autoReset: "day",
    showScore: true,
    scoreStyle: "points",
    minScore: 8,
    position: "tl",
    pos: null,
    collapsed: false,
    opacity: 1,
    scale: 1,
  };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
  function normalize(c) {
    const out = { ...DEFAULT, ...(c || {}) };
    out.items = Array.isArray(out.items) ? out.items.filter((i) => i && i.id) : DEFAULT.items;
    const ids = new Set(out.items.map((i) => i.id));
    out.checked = (Array.isArray(out.checked) ? out.checked : []).filter((id) => ids.has(id));
    if (out.autoReset === "day" && out.checked.length && out.checkedDay !== today()) out.checked = [];
    return out;
  }
  function score(c, checked = c.checked) {
    const set = new Set(checked || []);
    let got = 0, total = 0;
    for (const it of c.items || []) { const p = Math.max(0, +it.pts || 0); total += p; if (set.has(it.id)) got += p; }
    const pct = total ? Math.round((got / total) * 100) : 0;
    const grade = pct >= 90 ? "A+" : pct >= 80 ? "A" : pct >= 70 ? "B" : pct >= 55 ? "C" : "D";
    const min = Math.max(0, +c.minScore || 0);
    return { got, total, pct, grade, min, ready: min > 0 ? got >= min : null };
  }
  // Apply something you did on the chart (tick, reset, collapse, drag) to the stored checklist.
  function applyEvent(c, ev) {
    c = normalize(c);
    if (Array.isArray(ev.checked)) { const ids = new Set(c.items.map((i) => i.id)); c.checked = ev.checked.filter((id) => ids.has(id)); c.checkedDay = today(); }
    if (typeof ev.collapsed === "boolean") c.collapsed = ev.collapsed;
    if (ev.pos && isFinite(ev.pos.x) && isFinite(ev.pos.y)) c.pos = { x: Math.min(0.97, Math.max(0, +ev.pos.x)), y: Math.min(0.97, Math.max(0, +ev.pos.y)) };
    return c;
  }
  const api = { DEFAULT, normalize, score, applyEvent, today };
  root.MSK_CHECK = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);

// Shared by every part of the MSK extension: storage, presets, media database, payload.
(function (g) {
  const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  const DEFAULT_SETTINGS = { theme: "dark", rotation: { enabled: false, minutes: 15 }, fxFps: 11, showLogs: false, hotkeys: {}, autoUpdate: true };

  function baseConfig(name, chart = {}, bg = {}) {
    return {
      id: uid(), name, builtIn: false, rotate: false, createdAt: Date.now(), updatedAt: Date.now(),
      bg: { mediaId: null, mode: "behind", fit: "cover", position: "center", opacity: 0.85, blur: 0, brightness: 0.8, saturation: 1, speed: 1, tint: "#000000", tintStrength: 0.25, vignette: 0.45, base: { mode: "solid", color: "#000000", color2: "#0B3B3A", angle: 160 }, ...bg },
      chart: { apply: true, up: "#FFFFFF", down: "#3A3A3A", borderUp: "#FFFFFF", borderDown: "#8A8A8A", wickUp: "#FFFFFF", wickDown: "#8A8A8A", paneBg: "#000000", paneTransparent: true, grid: false, gridColor: "#FFFFFF14", text: "#D9D9D9", crosshair: "#39C5BB", ...chart },
      ui: { glassToolbars: false }, fx: [], fxOn: true,
    };
  }
  function presets() {
    return [
      baseConfig("Monochrome"),
    ].map((c) => ({ ...c, builtIn: true }));
  }

  async function load() {
    const d = await chrome.storage.local.get(null);
    if (!d.configs || !d.configs.length) {
      const configs = presets();
      const init = { settings: DEFAULT_SETTINGS, media: [], configs, activeConfigId: configs[0].id, enabled: true, fxPaused: false, preview: null, lastRotate: Date.now() };
      await chrome.storage.local.set(init);
      return init;
    }
    d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}), rotation: { ...DEFAULT_SETTINGS.rotation, ...((d.settings || {}).rotation || {}) } };
    d.media = d.media || [];
    // 1.4: Monochrome is the only built-in look. Drop the old untouched presets (your own copies stay).
    const kept = d.configs.filter((c) => !c.builtIn || ["MSK Mono", "Monochrome"].includes(c.name));
    if (kept.length !== d.configs.length || kept.some((c) => c.builtIn && c.name === "MSK Mono")) {
      kept.forEach((c) => { if (c.builtIn && c.name === "MSK Mono") c.name = "Monochrome"; });
      d.configs = kept.length ? kept : presets();
      if (!d.configs.find((c) => c.id === d.activeConfigId)) d.activeConfigId = d.configs[0].id;
      await chrome.storage.local.set({ configs: d.configs, activeConfigId: d.activeConfigId });
    }
    if (!d.configs.find((c) => c.id === d.activeConfigId)) d.activeConfigId = d.configs[0].id;
    return d;
  }

  // Media blobs live in IndexedDB (extension origin), metadata in chrome.storage.
  let dbp = null;
  function db() {
    return (dbp = dbp || new Promise((res, rej) => {
      const r = indexedDB.open("msk", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("files");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  }
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction("files", mode); const out = fn(t.objectStore("files")); t.oncomplete = () => res(out && out.result); t.onerror = () => rej(t.error); }); };
  const fput = (k, v) => tx("readwrite", (s) => { s.put(v, k); });
  const fget = (k) => tx("readonly", (s) => s.get(k));
  const fdel = (k) => tx("readwrite", (s) => { s.delete(k); });
  const fclear = () => tx("readwrite", (s) => { s.clear(); });

  function activeConfig(d) { return d.configs.find((c) => c.id === d.activeConfigId) || d.configs[0]; }
  function payload(d) {
    let cfg = d.preview || activeConfig(d);
    if (cfg && d.fxPaused) cfg = { ...cfg, fxOn: false };
    const m = cfg && cfg.bg.mediaId && d.media.find((x) => x.id === cfg.bg.mediaId);
    const s = d.settings || {};
    const checklist = g.MSK_CHECK ? { ...g.MSK_CHECK.normalize(s.checklist), accent: (s.appearance && s.appearance.accent) || "#39C5BB" } : null;
    return { on: !!d.enabled, fxMs: Math.round(1000 / (s.fxFps || 11)), frameMs: Math.round(1000 / (s.bgFps || 30)), cfg, media: m ? { id: m.id, type: m.type, rev: m.rev || 0 } : null, external: true, checklist };
  }
  function nextId(d, pool) {
    const list = pool && pool.length ? pool : d.configs;
    const i = list.findIndex((c) => c.id === d.activeConfigId);
    return list[(i + 1) % list.length].id;
  }

  g.MSKX = { uid, baseConfig, presets, load, fput, fget, fdel, fclear, payload, nextId, activeConfig, DEFAULT_SETTINGS };
})(typeof self !== "undefined" ? self : window);
