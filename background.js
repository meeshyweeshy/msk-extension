importScripts("common.js");
const ensureAlarm = () => chrome.alarms.create("rotate", { periodInMinutes: 1 });
chrome.runtime.onInstalled.addListener(async () => { await MSKX.load(); ensureAlarm(); });
chrome.runtime.onStartup.addListener(async () => { await chrome.storage.local.set({ preview: null }); ensureAlarm(); });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "rotate") return;
  const d = await MSKX.load(), r = d.settings.rotation;
  if (!r || !r.enabled || Date.now() - (d.lastRotate || 0) < Math.max(1, r.minutes) * 60000) return;
  await chrome.storage.local.set({ activeConfigId: MSKX.nextId(d, d.configs.filter((c) => c.rotate)), lastRotate: Date.now(), preview: null });
});
chrome.commands.onCommand.addListener(async (cmd) => {
  const d = await MSKX.load();
  if (cmd === "toggle-bg") chrome.storage.local.set({ enabled: !d.enabled });
  if (cmd === "next-config") chrome.storage.local.set({ activeConfigId: MSKX.nextId(d), lastRotate: Date.now(), preview: null });
  if (cmd === "toggle-fx") chrome.storage.local.set({ fxPaused: !d.fxPaused });
});
