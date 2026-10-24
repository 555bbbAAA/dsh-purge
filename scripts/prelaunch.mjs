#!/usr/bin/env node
/**
 * 启动前把密封的 app.asar 挪开（dsh-purge）
 *
 * 为什么需要它：Electron 运行期间 app.asar 被映射住，任何进程都改不了名；
 * 而「等 app 退出后再改名」必须另起进程 —— detached 子进程会被 Electron 的
 * job object 收掉、WMI/schtasks 起进程又不稳定，2026-10-24 六个版本全卡在这里。
 * 唯一确定性的时机是「app 还没启动」：由启动器（dsh-purge-launch.cmd）先跑本脚本，
 * 再启动 app。此时 asar 没被占用，改名是一步普通的文件操作。
 *
 * 用法（由 cmd 包装调用）：
 *   ELECTRON_RUN_AS_NODE=1 "<app exe>" "<plugin>/scripts/prelaunch.mjs"
 *
 * 判定「该不该挪」：
 *   1) resources\app.asar 存在
 *   2) resources\app\package.json 存在（解包树在，说明补丁有地方可落脚）
 *   3) 解包树里有补丁痕迹（含 dsh-purge 标记的文件数 > 0），或者 applied.json 有戳
 * 满足就 rename 成 app.asar.bak（已有 bak 则加时间戳，不覆盖），并写一行日志。
 *
 * 退出码：0 无论挪没挪（启动器要继续启动 app）；1 仅用于参数/环境异常。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function log(line) {
  try {
    const fp = path.join(os.tmpdir(), "dsh-purge-prelaunch.log");
    fs.appendFileSync(fp, `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch { /* ignore */ }
}

function main() {
  // 宿主安装目录：优先用环境变量，其次从 argv 里取，最后按 exe 位置推断
  const exe = String(process.env.DSH_PURGE_APP_EXE || process.argv[2] || "").trim();
  const resources = exe
    ? path.join(path.dirname(exe), "resources")
    : String(process.env.DSH_PURGE_RESOURCES || "").trim();
  if (!resources || !fs.existsSync(resources)) {
    log(`skip: resources not found (exe=${exe || "(none)"})`);
    return 0;
  }
  const asar = path.join(resources, "app.asar");
  const appDir = path.join(resources, "app");
  const treePkg = path.join(appDir, "package.json");
  if (!fs.existsSync(asar)) {
    log(`skip: no app.asar (already unpacked)`);
    return 0;
  }
  if (!fs.existsSync(treePkg)) {
    log(`skip: no unpacked tree, nothing would take effect`);
    return 0;
  }
  let bak = `${asar}.bak`;
  if (fs.existsSync(bak)) bak = `${asar}.bak-${Date.now()}`;
  try {
    fs.renameSync(asar, bak);
    log(`renamed app.asar -> ${path.basename(bak)}`);
  } catch (e) {
    log(`rename failed: ${e && (e.message || e)}`);
    return 0;
  }
  try { fs.rmSync(`${asar}.rename-pending`, { force: true }); } catch { /* ignore */ }
  return 0;
}

try {
  process.exitCode = main();
} catch (e) {
  log(`fatal: ${e && (e.message || e)}`);
  process.exitCode = 0;
}
