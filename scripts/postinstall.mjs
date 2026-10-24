#!/usr/bin/env node
/**
 * dsh-purge 安装后处理：把密封的 app.asar 解开成 resources\app，然后把 asar 挪走。
 *
 * 为什么需要这一步（也是「用户零操作」的关键）：
 * - Electron 只有在 app.asar 不存在时才会去读 resources\app；
 * - 而 asar 一旦被 Electron 加载就会被锁住，运行时无法改名；
 * - 安装插件这一刻 app 正好没在跑 —— 所以解包 + 改名放在这里做，之后每次启动
 *   Electron 都直接读解包树，插件在启动时把补丁写进树里就立即生效，
 *   不需要换包助手、不需要额外快捷方式、不需要用户点任何东西。
 *
 * 用法：
 *   ELECTRON_RUN_AS_NODE=1 "<app exe>" "<plugin>/scripts/postinstall.mjs" [--dry-run]
 *   （或用任意 node 跑；argv 里可以给 app exe 路径）
 *
 * 做的事：
 *   1. 找宿主安装目录（DSH_DESKTOP_INSTALL → argv → 常见位置）
 *   2. 若 resources\app.asar 存在：
 *      - 解包到 resources\app（已存在则覆盖）
 *      - 把 app.asar 改名为 app.asar.bak（已有 bak 则加时间戳）
 *   3. 打印结果并写日志到 %TEMP%\dsh-purge-postinstall.log
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");

function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  try { fs.appendFileSync(path.join(os.tmpdir(), "dsh-purge-postinstall.log"), `${text}\n`, "utf8"); } catch { /* ignore */ }
  try { console.log(text); } catch { /* ignore */ }
}

function candidateExes() {
  const out = [];
  const envExe = String(process.env.DSH_DESKTOP_INSTALL || "").trim();
  const argvExe = String(process.argv[2] || "").trim();
  for (const p of [argvExe, envExe]) {
    if (!p) continue;
    out.push(p.endsWith(".exe") ? p : path.join(p, "DeepSeek Harness.exe"));
  }
  const home = process.env.USERPROFILE || os.homedir();
  out.push(path.join(home, "AppData", "Local", "Programs", "DeepSeek Harness", "DeepSeek Harness.exe"));
  out.push(path.join("C:\\Program Files", "DeepSeek Harness", "DeepSeek Harness.exe"));
  return out;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const renameOnlyIdx = process.argv.indexOf("--rename-only");
  if (renameOnlyIdx >= 0) return await renameAside(process.argv[renameOnlyIdx + 1], false);
  const exe = candidateExes().find((p) => p && fs.existsSync(p));
  if (!exe) {
    log("skip: 找不到 dsh 安装目录（可用 DSH_DESKTOP_INSTALL 指定）");
    return 0;
  }
  const resources = path.join(path.dirname(exe), "resources");
  const asar = path.join(resources, "app.asar");
  const appDir = path.join(resources, "app");
  log(`安装目录 ${path.dirname(exe)}`);
  if (!fs.existsSync(asar)) {
    log("skip: app.asar 不存在（已经是解包态）");
    return 0;
  }
  const { extractAsar } = await import(new URL("../lib/extract-asar.js", import.meta.url).href);
  if (dry) {
    log(`dry-run: 会解包 ${asar} -> ${appDir} 然后改名`);
    return 0;
  }
  try {
    fs.mkdirSync(appDir, { recursive: true });
    await extractAsar(asar, appDir);
    log(`已解包 -> ${appDir}`);
  } catch (e) {
    log(`解包失败: ${e && (e.message || e)}`);
    return 1;
  }
  return await renameAside(asar, dry);
}

async function renameAside(asar, dry) {
  let bak = `${asar}.bak`;
  if (fs.existsSync(bak)) bak = `${asar}.bak-${Date.now()}`;
  if (dry) { log(`dry-run: 会把 ${path.basename(asar)} 改名`); return 0; }
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      fs.renameSync(asar, bak);
      log(`已改名 app.asar -> ${path.basename(bak)}`);
      try { fs.rmSync(`${asar}.rename-pending`, { force: true }); } catch { /* ignore */ }
      return 0;
    } catch (e) {
      if (Date.now() >= deadline) {
        // 本进程读过这个 182MB 文件，句柄/扫描锁可能还在；换一个干净进程再试一次
        log(`本进程改名失败（${e && (e.message || e)}），改用子进程重试`);
        const { spawnSync } = await import("node:child_process");
        const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--rename-only", asar], { stdio: "ignore" });
        return r.status === 0 ? 0 : 1;
      }
      await new Promise((res) => setTimeout(res, 500));
    }
  }
  try { fs.rmSync(`${asar}.rename-pending`, { force: true }); } catch { /* ignore */ }
  log("完成：以后启动直接读解包树，插件在启动时写补丁即生效");
  return 0;
}

process.exitCode = await main().catch((e) => {
  log(`fatal: ${e && (e.message || e)}`);
  return 1;
});
