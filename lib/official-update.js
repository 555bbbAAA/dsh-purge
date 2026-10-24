// 官方客户端升级后的补丁回写标记。wscript 字面量给重启脚本用。
import path from "node:path";
import { hostFs as fs } from "./extract-asar.js";

const MARKER_NAME = "dsh-purge-reapply-asar";

function harnessExeName(exe) {
  const base = path.basename(String(exe || "")).toLowerCase();
  if (base === "deepseek harness.exe" || base === "deepseek-harness.exe") return true;
  // Linux / macOS：无 .exe 后缀的宿主名，以及 AppImage 本体。
  // 注意：wscript 只在 Windows 上跑，这里放宽名字判断只是为了让升级标记机制跨平台可用
  // （标记文件的读写本身是纯 fs 操作，不依赖平台）。
  if (base === "deepseek harness" || base === "deepseek-harness" || base === "dsh-desktop") return true;
  if (/^deepseek[\s._-]*harness[^/]*\.appimage$/i.test(base)) return true;
  if (/^dsh[\s._-]*desktop[^/]*\.appimage$/i.test(base)) return true;
  return false;
}

export function upgradeMarkerPath(exe) {
  if (!harnessExeName(exe)) return "";
  const base = path.basename(String(exe || "")).toLowerCase();
  // AppImage 是单文件分发：升级等于整个文件被替换，标记无法预置在旧文件旁边。
  // 这类安装不做升级握手，返回空让调用方跳过。
  if (/\.appimage$/i.test(base)) return "";
  return path.join(path.dirname(exe), "resources", MARKER_NAME);
}

export function upgradeMarkerExists(exe) {
  const marker = upgradeMarkerPath(exe);
  return Boolean(marker && fs.existsSync(marker));
}

export function clearUpgradeMarker(exe) {
  const marker = upgradeMarkerPath(exe);
  if (!marker) return;
  try { fs.rmSync(marker, { force: true }); } catch { /* 下次启动再试 */ }
}

export function clearStaleExtractedApps(exe) {
  if (!harnessExeName(exe)) return;
  const resources = path.join(path.dirname(exe), "resources");
  let names = [];
  try { names = fs.readdirSync(resources); } catch { return; }
  for (const name of names) {
    if (!name.startsWith("app.dshpurge-prev")) continue;
    try { fs.rmSync(path.join(resources, name), { recursive: true, force: true }); } catch { /* 旧目录删不掉不影响新版本 */ }
  }
}

/** Windows Script Host 无 BOM 时按系统 ANSI 读文件。中文路径写成 \uXXXX，整份脚本保持 ASCII。 */
export function wshLiteral(value) {
  return JSON.stringify(String(value ?? "")).replace(/[\u007f-\uffff]/g, (ch) => {
    return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

export function isWshAscii(source) {
  const text = String(source || "");
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}
