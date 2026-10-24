/**
 * 读当前安装的 dsh（宿主）版本。
 *
 * 为什么要有这个：官方升级后宿主从 0.2.1-rc.2 变成 rc.3，插件要能自己发现这件事，
 * 再去远程找一版匹配的插件升级上来。判据不能看「文件里有没有某段字串」，要有明确的版本号。
 *
 * 顺序：resources/app/package.json（解包态）→ app.asar 里的 package.json（密封态）。
 * 密封态必须直接解析归档头，不能靠 node:fs 进 asar。
 */
import fs from "node:fs";
import path from "node:path";
import * as desktop from "./desktop.js";
import { readAsarEntryText } from "./extract-asar.js";

/** 桌面安装的 resources 目录；找不到返回空串。 */
export function desktopResourcesDir() {
  let exe = "";
  try { exe = desktop.findDesktopAppExecutable() || desktop.findDesktopAppExecutable({ discover: true }); } catch { exe = ""; }
  if (!exe) return "";
  const dir = path.join(path.dirname(exe), "resources");
  return fs.existsSync(dir) ? dir : "";
}

function versionFromPackageJsonText(text) {
  if (!text) return "";
  try {
    const doc = JSON.parse(text);
    return doc && doc.version ? String(doc.version) : "";
  } catch {
    return "";
  }
}

/**
 * @param {{ resourcesDir?: string }} [input]
 * @returns {{ version: string, source: string, resources: string, asar: string }}
 */
export function readHostVersion(input = {}) {
  const resources = String(input.resourcesDir || "").trim() || desktopResourcesDir();
  const report = { version: "", source: "", resources, asar: "" };
  if (!resources) return report;

  const unpacked = path.join(resources, "app", "package.json");
  try {
    const text = fs.readFileSync(unpacked, "utf8");
    const version = versionFromPackageJsonText(text);
    if (version) {
      report.version = version;
      report.source = "unpacked";
      return report;
    }
  } catch { /* 解包态不存在，继续看 asar */ }

  const asar = path.join(resources, "app.asar");
  report.asar = fs.existsSync(asar) ? asar : "";
  if (!report.asar) return report;
  try {
    const version = versionFromPackageJsonText(readAsarEntryText(asar, "package.json"));
    if (version) {
      report.version = version;
      report.source = "asar";
    }
  } catch { /* 头读不出来就返回空 */ }
  return report;
}

/** 宿主主版本是否变了（只比 version 字符串，够用且明确）。 */
export function hostVersionChanged(recorded, current) {
  const a = String(recorded || "").trim();
  const b = String(current || "").trim();
  if (!b) return false;
  if (!a) return true;
  return a !== b;
}
