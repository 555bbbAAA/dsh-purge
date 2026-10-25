import { adapterFor, detectSurface } from "./surface.js";
import * as desktop from "./desktop.js";
import * as web from "./web.js";
import { inOfficialInstallWindow } from "./core.js";

const ADAPTERS = {
  web,
  desktop,
};

export function currentSurface(input) {
  return detectSurface(input);
}

export function hostAdapter(kind = detectSurface()) {
  return ADAPTERS[adapterFor(kind)] || web;
}

export function scheduleRestart(request, ctx, options = {}) {
  // 2026-10-26（Royan 定）：官方安装空窗期内绝不拉起宿主 —— 会撞 NSIS 的「程序正在运行」
  const win = (() => { try { return inOfficialInstallWindow(); } catch { return { hit: false }; } })();
  if (win.hit) return { ok: false, skipped: "official-install-window", why: win.why || "" };
  return hostAdapter().scheduleRestart(request, ctx, options);
}

export function scheduleCleanupRestart(opts) {
  const win = (() => { try { return inOfficialInstallWindow(); } catch { return { hit: false }; } })();
  if (win.hit) return { ok: false, skipped: "official-install-window", why: win.why || "" };
  return hostAdapter().scheduleCleanupRestart(opts);
}

export function restartNote() {
  return hostAdapter().restartNote();
}
