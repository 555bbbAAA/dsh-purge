/**
 * 从官方归档（app.asar）重建 .dshpurge.bak 基线。
 *
 * 背景：1.1.72 之前的 refreshStaleBaksForUpgrade 把「当前文件里没有 dsh-purge 字串」当成
 * 「官方新版」，于是把唯一一份原始备份刷成了已打补丁的字节（2026-10-24 审计实测 50/52 已烧）。
 * 之后 revertAll 看到 current == bak 就跳过，回滚与卸载都还原不了这些文件。
 *
 * 这里从归档里取回官方原文，只替换「bak 与当前文件逐字节相同」的那种坏备份：
 *   · 正式文件一律不碰，只写 <file>.dshpurge.bak
 *   · 干净备份（bak != current）一律不动
 *   · 归档里没有对应条目、或当前文件本来就是官方原文的，跳过并记录原因
 *
 * 默认只出计划，加 write:true 才落盘。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as core from "./core.js";
import { extractAsarSelected } from "./extract-asar.js";

const BAK_SUFFIX = ".dshpurge.bak";

/** aiBase = <app>/dsh/node_modules/@deepseek-ai，往上三层就是 resources/app。 */
export function appDirOfAiBase(aiBase) {
  const base = String(aiBase || "").trim();
  if (!base) return "";
  return path.dirname(path.dirname(path.dirname(path.normalize(base))));
}

function resourcesDirOf(appDir) {
  return path.dirname(appDir);
}

/** 找一份可用的官方归档：显式路径 > 相邻的 app.asar > 最新的 app.asar.*-official。 */
export function resolveAsarArchive(explicit, appDir) {
  const given = String(explicit || "").trim();
  if (given) {
    const abs = path.normalize(given);
    return fs.existsSync(abs) ? abs : "";
  }
  if (!appDir) return "";
  const resources = resourcesDirOf(appDir);
  let names = [];
  try { names = fs.readdirSync(resources); } catch { return ""; }
  const plain = names.find((n) => n === "app.asar");
  if (plain) return path.join(resources, plain);
  const backups = names
    .filter((n) => /^app\.asar\..+/.test(n))
    .map((n) => {
      const fp = path.join(resources, n);
      let at = 0;
      try { at = fs.statSync(fp).mtimeMs; } catch { at = 0; }
      return { fp, at };
    })
    .sort((a, b) => b.at - a.at);
  return backups[0]?.fp || "";
}

function collectTargets(aiBase) {
  const files = core.targetFiles(aiBase);
  const out = new Map();
  for (const value of Object.values(files)) {
    const list = Array.isArray(value) ? value : [value];
    for (const fp of list) {
      if (!fp || typeof fp !== "string") continue;
      out.set(path.normalize(fp), true);
    }
  }
  return [...out.keys()];
}

function readIfExists(fp) {
  try { return fs.readFileSync(fp); } catch { return null; }
}

/**
 * 单个文件的判定（纯函数，便于自检）：
 * "no-archive-entry" 归档里没有这条 / "missing-current" 正式文件不在 / "no-backup" 没有备份 /
 * "already-pristine" 备份就是官方原文 / "backup-differs-keep" 备份和当前不同，留着 /
 * "current-is-official" 当前文件本来就是官方原文（没打过补丁）/ "repair" 该重建。
 */
export function classifyBackup({ shipped, current, bak }) {
  if (!shipped || shipped.length === 0) return "no-archive-entry";
  if (!current) return "missing-current";
  if (!bak) return "no-backup";
  if (bak.equals(shipped)) return "already-pristine";
  if (!bak.equals(current)) return "backup-differs-keep";
  if (current.equals(shipped)) return "current-is-official";
  return "repair";
}

/**
 * @param {{ asarPath?: string, aiBase?: string, write?: boolean }} options
 */
export async function repairBackups(options = {}) {
  const aiBase = String(options.aiBase || "").trim() || core.findAiBase() || "";
  if (!aiBase) return { ok: false, error: core.missingAiBaseMessage(), replaced: [], rows: [] };
  const appDir = appDirOfAiBase(aiBase);
  const asar = resolveAsarArchive(options.asarPath, appDir);
  if (!asar) {
    return { ok: false, error: `找不到官方归档：${path.join(resourcesDirOf(appDir), "app.asar")}`, replaced: [], rows: [] };
  }
  let asarStat = null;
  try { asarStat = fs.statSync(asar); } catch { asarStat = null; }

  const targets = collectTargets(aiBase).filter((fp) => {
    const rel = path.relative(appDir, fp);
    return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
  });
  if (!targets.length) return { ok: false, error: "没有可修复的目标文件", replaced: [], rows: [], asar };

  const wanted = new Map();
  for (const fp of targets) {
    const rel = path.relative(appDir, fp).replace(/\\/g, "/");
    wanted.set(rel.toLowerCase(), fp);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-bakfix-"));
  const rows = [];
  const replaced = [];
  try {
    extractAsarSelected(asar, tempDir, new Set(wanted.keys()));
    for (const [rel, fp] of wanted) {
      const cand = path.join(tempDir, ...rel.split("/"));
      const shipped = readIfExists(cand);
      const current = readIfExists(fp);
      const bakFp = fp + BAK_SUFFIX;
      const bak = readIfExists(bakFp);
      const verdict = classifyBackup({ shipped, current, bak });
      if (verdict !== "repair") {
        rows.push({ path: fp, action: verdict });
        continue;
      }
      if (options.write !== true) {
        rows.push({ path: fp, action: "would-repair", bytes: shipped.length });
        continue;
      }
      try {
        core.atomicWriteSync(bakFp, shipped);
        replaced.push(fp);
        rows.push({ path: fp, action: "repaired", bytes: shipped.length });
      } catch (error) {
        rows.push({ path: fp, action: "write-failed", detail: String(error && error.message ? error.message : error) });
      }
    }
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* 临时目录清不掉不影响结果 */ }
  }

  const wouldRepair = rows.filter((r) => r.action === "would-repair").length;
  return {
    ok: true,
    wrote: options.write === true,
    asar,
    asar_size: asarStat?.size || 0,
    app_dir: appDir,
    ai_base: aiBase,
    targets: targets.length,
    replaceable: wouldRepair + replaced.length,
    replaced,
    rows,
  };
}
