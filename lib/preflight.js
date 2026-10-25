#!/usr/bin/env node
/**
 * dsh-purge preflight：在宿主启动早期做「runtime 自愈」。
 *
 * 背景（2026-10-25 VM 实测，同一晚复发四次）：
 * 官方安装器/更新器有时不写 `resources\runtime`（或把它清空），
 * 而 `@deepseek-ai/dsh-skill-office` 在 dsh-base 加载时就会读
 * `resources\runtime\office-skills\office\SKILL.md` → ENOENT → 宿主启动即崩，
 * 插件根本没机会加载。
 *
 * 本模块是一个**零依赖、零服务**的 cordis 插件：apply 时同步做三件事
 *   1) 若 runtime 缺关键文件 → 用插件自带的 assets/runtime-min 补上（23KB）
 *   2) 若 runtime 完整且还没备份 → 备份到 <DSH_HOME>\dsh-purge\runtime-backup
 *   3) 若 runtime 残缺且有备份 → 整目录恢复
 * 只做文件操作，不碰网络、不依赖任何 ctx 服务，加载失败也不会影响宿主。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-purge-preflight";
export const inject = [];

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const assetsMin = path.join(pluginRoot, "assets", "runtime-min");

const REQUIRED = [
  "office-skills/office/SKILL.md",
  "versions.json",
];

const RUNTIME_DIRS = ["bin", "cli", "office-skills", "primary-runtime", "versions.json"];

function log(line) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), "dsh-purge-preflight.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch { /* ignore */ }
}

function installRoots() {
  const out = [];
  // 最可靠的是「当前进程自己的 exe」——插件跑在宿主进程里，process.execPath 就是
  // DeepSeek Harness.exe。以前只按 USERPROFILE 猜，插件被别的账号上下文驱动时
  // （实测以 dshops 起）会找不到安装目录，直接 skip（2026-10-25 压测暴露）。
  try {
    const exe = String(process.execPath || "");
    if (/DeepSeek Harness\.exe$/i.test(exe)) out.push(path.dirname(exe));
  } catch { /* ignore */ }
  const env = String(process.env.DSH_DESKTOP_INSTALL || "").trim();
  if (env) out.push(env.endsWith(".exe") ? path.dirname(env) : env);
  try {
    const home = process.env.USERPROFILE || os.homedir();
    out.push(path.join(home, "AppData", "Local", "Programs", "DeepSeek Harness"));
  } catch { /* ignore */ }
  out.push("C:\\Program Files\\DeepSeek Harness");
  return out;
}

/** DSH_HOME 可能是别的账号（压测里以 dshops 起进程），备份实际在真实用户目录下。 */
function backupCandidates(home) {
  const out = [];
  if (home) out.push(path.join(home, "dsh-purge", "runtime-backup"));
  try {
    const users = "C:\\Users";
    for (const name of fs.readdirSync(users)) {
      if (name === "Public" || name === "Default" || name === "All Users") continue;
      const p = path.join(users, name, ".dsh", "dsh-purge", "runtime-backup");
      if (!out.includes(p)) out.push(p);
    }
  } catch { /* ignore */ }
  return out;
}

function copyTree(from, to) {
  let copied = 0;
  const walk = (src, dst) => {
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      for (const ent of fs.readdirSync(src)) walk(path.join(src, ent), path.join(dst, ent));
      return;
    }
    if (fs.existsSync(dst)) return; // 只补缺失，不覆盖用户/官方已有文件
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied += 1;
  };
  walk(from, to);
  return copied;
}

function dshHome() {
  const env = String(process.env.DSH_HOME || "").trim();
  if (env) return env;
  try { return path.join(process.env.USERPROFILE || os.homedir(), ".dsh"); } catch { return ""; }
}

function repairRuntime(runtimeDir) {
  const missing = REQUIRED.filter((rel) => !fs.existsSync(path.join(runtimeDir, rel)));
  if (missing.length === 0) return { ok: true, patched: 0, missing };
  if (!fs.existsSync(assetsMin)) return { ok: false, patched: 0, missing, reason: "no-assets" };
  let patched = 0;
  for (const dir of RUNTIME_DIRS) {
    const src = path.join(assetsMin, dir);
    if (!fs.existsSync(src)) continue;
    try { patched += copyTree(src, path.join(runtimeDir, dir)); } catch (e) { log(`copy ${dir} failed: ${e && (e.message || e)}`); }
  }
  const stillMissing = REQUIRED.filter((rel) => !fs.existsSync(path.join(runtimeDir, rel)));
  return { ok: stillMissing.length === 0, patched, missing: stillMissing };
}

function runtimeComplete(runtimeDir) {
  return REQUIRED.every((rel) => fs.existsSync(path.join(runtimeDir, rel)))
    && fs.existsSync(path.join(runtimeDir, "primary-runtime"));
}

function backupRuntime(runtimeDir, backupDir) {
  if (fs.existsSync(backupDir)) return { skipped: true };
  fs.mkdirSync(backupDir, { recursive: true });
  let n = 0;
  for (const dir of RUNTIME_DIRS) {
    const src = path.join(runtimeDir, dir);
    if (!fs.existsSync(src)) continue;
    try { n += copyTree(src, path.join(backupDir, dir)); } catch (e) { log(`backup ${dir} failed: ${e && (e.message || e)}`); }
  }
  return { skipped: false, files: n };
}

function restoreRuntime(runtimeDir, backupDir) {
  if (!fs.existsSync(backupDir)) return { restored: 0 };
  let n = 0;
  for (const dir of RUNTIME_DIRS) {
    const src = path.join(backupDir, dir);
    if (!fs.existsSync(src)) continue;
    try { n += copyTree(src, path.join(runtimeDir, dir)); } catch { /* ignore */ }
  }
  return { restored: n };
}

export function apply() {
  try {
    const root = installRoots().find((p) => p && fs.existsSync(path.join(p, "DeepSeek Harness.exe")));
    if (!root) { log("skip: 找不到宿主安装目录"); return; }
    const runtimeDir = path.join(root, "resources", "runtime");
    fs.mkdirSync(runtimeDir, { recursive: true });
    const home = dshHome();
    const backupDir = home ? path.join(home, "dsh-purge", "runtime-backup") : "";

    const before = REQUIRED.filter((rel) => !fs.existsSync(path.join(runtimeDir, rel)));
    const fixed = repairRuntime(runtimeDir);
    if (before.length > 0) log(`repair: 缺 ${before.join(", ")} → patched=${fixed.patched} ok=${fixed.ok}`);

    const backups = backupCandidates(home);
    const usableBackup = backups.find((p) => fs.existsSync(p));
    if (runtimeComplete(runtimeDir)) {
      const target = backupDir || usableBackup;
      if (target) {
        const b = backupRuntime(runtimeDir, target);
        if (!b.skipped) log(`backup: 已备份 runtime → ${target}（${b.files} 个文件）`);
      }
    } else if (usableBackup) {
      const r = restoreRuntime(runtimeDir, usableBackup);
      if (r.restored > 0) log(`restore: 从备份恢复 ${r.restored} 个文件（${usableBackup}）→ ${runtimeDir}`);
    }
    ensureBundleFirst(home);
    ensureRuntimeGuard(home);
    pruneOldBackups(home);
    // 1.2.2：按磁盘事实补写解包标记（换包脚本偶发不写，缺了会让自愈把 asar 装回来）
    try { ensureUnpackedMarker(); } catch { /* 补写失败不影响启动 */ }
    log(`done: runtime=${runtimeDir} ok=${REQUIRED.every((rel) => fs.existsSync(path.join(runtimeDir, rel)))}`);
  } catch (e) {
    log(`fatal: ${e && (e.message || e)}`);
  }
}

/**
 * R5：清理历史遗留的插件备份目录（`dsh-purge.bak-*` / `dsh-purge.rc3-*`）。
 * 只保留最新的 1 个，其余删除；只碰这两个目录，遇到删不掉就跳过并记日志。
 * 现场：反复装插件后 `.dsh\plugins` 里堆了 36 个 200KB~1MB 的备份目录。
 */
function pruneOldBackups(home) {
  if (!home) return;
  const dirs = [
    path.join(home, "plugins"),
    path.join(home, "profiles", "desktop", "node_modules"),
  ];
  for (const dir of dirs) {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^dsh-purge\.(bak|rc3)/i.test(e.name))
        .map((e) => path.join(dir, e.name));
    } catch { continue; }
    if (ents.length <= 1) continue;
    // 按名字里的时间戳/修改时间排序，保留最新一个
    ents.sort((a, b) => {
      try { return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs; } catch { return 0; }
    });
    const keep = ents[0];
    let removed = 0;
    for (const victim of ents.slice(1)) {
      try { fs.rmSync(victim, { recursive: true, force: true }); removed += 1; } catch { /* 长路径删不掉就留着 */ }
    }
    if (removed > 0) log(`prune: ${dir} 删除 ${removed} 个旧备份，保留 ${path.basename(keep)}`);
  }
}

/**
 * 把本插件在 profile 的 bundles 列表里排到最前。
 *
 * 为什么必须排第一：`resources\runtime` 是 dsh-base 加载 `dsh-skill-office` 时就要读的，
 * 我们若排在 dsh-base 之后，崩溃发生时 preflight 还没跑（2026-10-25 实测）。
 * 排第一后 preflight 先执行（它 inject: []，不依赖任何服务），修好 runtime 再让 base 加载。
 * 写盘要求：**不能带 BOM**，写前先 JSON.parse 校验，写后再读回校验，失败一律回滚。
 */
/**
 * 补写「解包模式」标记。
 *
 * 为什么要 preflight 来做：标记原本只在换包脚本里写，实测有两次换包成功但标记没落地
 * （2026-10-25，PS1/watcher 路径各一次）。标记缺失会让自愈逻辑误判成密封态，
 * 把 app.asar 装回来、把解包树改名。这里在启动最早处按磁盘事实自愈：
 * 解包树在 + app.asar 不在 + 标记不在 → 补写标记。
 */
function ensureUnpackedMarker() {
  try {
    const root = installRoots().find((r) => fs.existsSync(r));
    if (!root) return "skip:no-root";
    const res = path.join(root, "resources");
    const tree = path.join(res, "app", "package.json");
    const asar = path.join(res, "app.asar");
    const marker = path.join(res, ".dshpurge-unpacked");
    if (!fs.existsSync(tree)) return "skip:no-tree";
    if (fs.existsSync(asar)) return "skip:asar-present";
    if (fs.existsSync(marker)) return "skip:has-marker";
    fs.writeFileSync(marker, `${new Date().toISOString()} unpacked (preflight backfill)\n`, "utf8");
    log("marker: 解包树在、asar 不在、标记缺 → 已补写");
    return "wrote-marker";
  } catch (e) {
    log(`marker: 补写失败 ${e && (e.message || e)}`);
    return "error";
  }
}

/**
 * A（1.2.15）：把 runtime 守卫装到「登录时启动」——不依赖 dsh-purge 是否被 bundles 加载。
 * 官方更新偶尔把 resources\runtime 清空，宿主在 dsh-base 阶段读 office SKILL.md 就崩；
 * 这条守卫在用户登录时先跑一遍（隐藏窗口），缺什么补什么。
 * 脚本落在 <DSH_HOME>\dsh-purge\runtime-guard.ps1（ASCII 路径），Startup 里只放一个纯 ASCII 的 vbs。
 */
function ensureRuntimeGuard(home) {
  try {
    if (!home) return;
    const pkgScript = path.join(dirnameOfImport(), '..', 'scripts', 'runtime-guard.ps1');
    if (!fs.existsSync(pkgScript)) { log('guard: 包内缺 scripts/runtime-guard.ps1，跳过'); return; }
    const dir = path.join(home, 'dsh-purge');
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'runtime-guard.ps1');
    const body = fs.readFileSync(pkgScript);
    let needWrite = true;
    try {
      const old = fs.readFileSync(target);
      needWrite = !old.equals(body);
    } catch { needWrite = true; }
    if (needWrite) { fs.writeFileSync(target, body); log('guard: runtime-guard.ps1 已更新 → ' + target); }
    const startup = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    if (!fs.existsSync(startup)) { log('guard: 找不到 Startup 目录，跳过'); return; }
    const vbs = path.join(startup, 'dsh-runtime-guard.vbs');
    const line = 'sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""' + target + '""", 0, False';
    const vbsBody = ['Option Explicit', 'Dim sh', 'Set sh = CreateObject("WScript.Shell")', line, ''].join('\r\n');
    let same = false;
    try { same = fs.readFileSync(vbs, 'utf8') === vbsBody; } catch { same = false; }
    if (!same) {
      // vbs 必须纯 ASCII：路径里出现非 ASCII 会被写成问号（2026-10-25 实踩）
      if (/[^\x00-\x7f]/.test(vbsBody)) { log('guard: 路径含非 ASCII，vbs 不写（避免变成问号）'); return; }
      fs.writeFileSync(vbs, vbsBody, 'ascii');
      log('guard: Startup 已注册 dsh-runtime-guard.vbs');
    }
  } catch (e) {
    log('guard: 安装失败（不影响启动）' + (e && (e.message || e)));
  }
}

function dirnameOfImport() {
  try { return path.dirname(fileURLToPath(import.meta.url)); } catch { return ''; }
}

function ensureBundleFirst(home) {
  try {
    if (!home) return;
    const profile = path.join(home, "profiles", "desktop", "package.json");
    if (!fs.existsSync(profile)) return;
    const raw = fs.readFileSync(profile, "utf8");
    const json = JSON.parse(raw);
    const bundles = json?.dsh?.profile?.bundles;
    if (!Array.isArray(bundles)) return;
    const idx = bundles.indexOf("dsh-purge");
    if (idx === 0) return; // 已经第一，什么都不做
    // 1.2.15（B）：以前 idx < 0（根本不在列表里）会直接 return，等于「被摘掉就永不回来」。
    // 现在把自己加回第 0 位：官方更新清空 runtime 时，只有排在 dsh-base 之前才救得了启动。
    const next = bundles.slice();
    if (idx > 0) next.splice(idx, 1);
    next.unshift("dsh-purge");
    json.dsh.profile.bundles = next;
    const out = `${JSON.stringify(json, null, 2)}\n`;
    JSON.parse(out);
    fs.writeFileSync(profile, out, "utf8");
    JSON.parse(fs.readFileSync(profile, "utf8"));
    log(`bundles: dsh-purge 已${idx > 0 ? "提到" : "补回"}最前（原位置 ${idx}）`);
  } catch (e) {
    log(`bundles: 调整失败（保持原样）${e && (e.message || e)}`);
  }
}
