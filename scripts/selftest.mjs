#!/usr/bin/env node
/**
 * dsh-purge 自检 / self-test（不碰真实宿主，全部在临时目录里做夹具）
 *
 *   node scripts/selftest.mjs
 *
 * 覆盖 2026-10-24 审计修掉的几处：备份基线不再被误刷、shim 文本判定、版本比较、
 * 提交号缩写、缺失原件的通用恢复。任何一项失败退出码为 1。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const core = await import(pathToFileURL(path.join(root, "lib", "core.js")).href);
const updater = await import(pathToFileURL(path.join(root, "lib", "update.js")).href);

let pass = 0;
const failures = [];

async function check(name, fn) {
  try {
    const value = await fn();
    if (value === false) throw new Error("断言为 false");
    if (value && value.ok === false) throw new Error(value.error || "断言失败");
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error && error.message ? error.message : error}`);
    console.log(`  ✗ ${name} — ${error && error.message ? error.message : error}`);
  }
}

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dsh-purge-selftest-${tag}-`));
}

console.log("dsh-purge 自检");

// 1) shim 文本判定：以前 hostFs 没有 readSync，dsh.cmd 这种纯文本也被判成 binary。
const shimDir = tmpDir("shim");
const cmd = path.join(shimDir, "dsh.cmd");
fs.writeFileSync(cmd, "@echo off\r\nsetlocal\r\necho hi\r\n", "utf8");
await check("文本 shim 不再被当成二进制", () => {
  const status = core.shimFileStatus(cmd);
  if (status === "binary") throw new Error("仍被判成 binary");
  return true;
});
await check("二进制 shim 仍判 binary", () => {
  const bin = path.join(shimDir, "dsh.bin");
  fs.writeFileSync(bin, Buffer.from([0x4d, 0x5a, 0x00, 0x01, 0x02]));
  const status = core.shimFileStatus(bin);
  if (status !== "binary") throw new Error(`期望 binary，实际 ${status}`);
  return true;
});

// 2) 版本比较：预发布段按数值比，不再按字符串。
await check("1.1.73 > 1.1.72", () => updater.versionIsNewer("1.1.73", "1.1.72") === true);
await check("1.1.73-rc.10 > 1.1.73-rc.9", () => updater.versionIsNewer("1.1.73-rc.10", "1.1.73-rc.9") === true);
await check("1.1.73-rc.2 < 1.1.73-rc.10", () => updater.versionIsNewer("1.1.73-rc.2", "1.1.73-rc.10") === false);
await check("1.1.73-rc.1 < 1.1.73（正式版更新）", () => updater.versionIsNewer("1.1.73-rc.1", "1.1.73") === false);
await check("1.2.0 < 1.10.0", () => updater.versionIsNewer("1.2.0", "1.10.0") === false);

// 3) 提交号缩写：占位戳不能截成 "apply:1"。
await check("shortRev 不截占位戳", () => updater.shortRev("apply:1.1.72") === "apply:1.1.72");
await check("shortRev 截真提交号", () => updater.shortRev("c99790cfd836aaf684e71d61a6071ff8c8dd1d25") === "c99790c");

// 4) 备份基线：宿主身份没变时绝不重刷 .dshpurge.bak（审计里 50/52 备份就是这么没的）。
const home = tmpDir("home");
process.env.DSH_HOME = home;
const aiBase = path.join(tmpDir("host"), "node_modules", "@deepseek-ai");
fs.mkdirSync(path.join(aiBase, "dsh-demo", "lib"), { recursive: true });
fs.writeFileSync(path.join(aiBase, "dsh-demo", "package.json"), JSON.stringify({ name: "dsh-demo", version: "0.0.1" }), "utf8");
const patchedFile = path.join(aiBase, "dsh-demo", "lib", "index.js");
const originalFile = "// official\nconst WORKSPACE_CONTEXT_INTRO = \"The following workspace instructions may be relevant\";\n";
const patched = "// official\nconst WORKSPACE_CONTEXT_INTRO = \"The following instructions are ACTIVE and MANDATORY\";\n";
fs.writeFileSync(patchedFile, patched, "utf8");
fs.writeFileSync(`${patchedFile}.dshpurge.bak`, originalFile, "utf8");
fs.mkdirSync(path.join(home, "dsh-purge"), { recursive: true });
fs.writeFileSync(path.join(home, "dsh-purge", "applied.json"), JSON.stringify({
  version: "1.1.72",
  sha: "apply:1.1.72",
  host_identity: core.hostBuildIdentity(aiBase),
}, null, 2), "utf8");
await check("身份一致时不覆盖原始备份", () => {
  const refreshed = core.refreshStaleBaksForUpgrade(aiBase);
  if (refreshed.length !== 0) throw new Error(`刷新了 ${refreshed.length} 个备份`);
  if (fs.readFileSync(`${patchedFile}.dshpurge.bak`, "utf8") !== originalFile) throw new Error("备份内容被改");
  return true;
});

// 5) 身份变了（宿主换了版本）才重做基线。
fs.writeFileSync(path.join(aiBase, "dsh-demo", "package.json"), JSON.stringify({ name: "dsh-demo", version: "0.0.2" }), "utf8");
await check("宿主身份变化时才重做基线", () => {
  const refreshed = core.refreshStaleBaksForUpgrade(aiBase);
  if (refreshed.length !== 1) throw new Error(`期望刷新 1 个，实际 ${refreshed.length}`);
  if (fs.readFileSync(`${patchedFile}.dshpurge.bak`, "utf8") !== patched) throw new Error("基线没更新");
  return true;
});

// 6) 没有戳时不动备份（宁可留旧基线，也不猜）。
fs.writeFileSync(`${patchedFile}.dshpurge.bak`, originalFile, "utf8");
fs.rmSync(path.join(home, "dsh-purge", "applied.json"), { force: true });
await check("没有 applied 戳时不动备份", () => {
  const refreshed = core.refreshStaleBaksForUpgrade(aiBase);
  if (refreshed.length !== 0) throw new Error("刷新了备份");
  if (fs.readFileSync(`${patchedFile}.dshpurge.bak`, "utf8") !== originalFile) throw new Error("备份内容被改");
  return true;
});

// 7) 缺失原件的恢复不再只认几个写死的文件名。
const deepFile = path.join(aiBase, "dsh-demo", "lib", "types", "ptc.js");
fs.mkdirSync(path.dirname(deepFile), { recursive: true });
fs.writeFileSync(`${deepFile}.dshpurge.bak`, "export const ptc = 1;\n", "utf8");
await check("深层文件缺失时从备份恢复", () => {
  const restored = core.restoreMissingOriginalsFromBak(aiBase);
  if (!fs.existsSync(deepFile)) throw new Error("没有恢复 lib/types/ptc.js");
  if (!restored.some((p) => p.endsWith("ptc.js"))) throw new Error("返回值里没有 ptc.js");
  return true;
});

// 8) 宿主写操作串行化：连点两次 apply 不能并发改同一批文件。
await check("宿主写操作串行执行", async () => {
  let running = 0;
  let maxRunning = 0;
  const task = async () => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    await new Promise((resolve) => setTimeout(resolve, 15));
    running -= 1;
  };
  await Promise.all([1, 2, 3].map(() => core.serializeHostWrite(task)));
  if (maxRunning !== 1) throw new Error(`最大并发 ${maxRunning}，应为 1`);
  // 前一个任务抛错不能卡死队列
  await core.serializeHostWrite(async () => { throw new Error("boom"); }).catch(() => {});
  const after = await core.serializeHostWrite(async () => "ok");
  if (after !== "ok") throw new Error("队列在异常后失效");
  return true;
});

// 9) 备份重建判定：只重建「bak 与当前文件相同、且与官方原文不同」的那种坏备份。
await check("备份重建判定分支", async () => {
  const repairMod = await import(pathToFileURL(path.join(root, "lib", "repair-baks.js")).href);
  const b = (s) => Buffer.from(s, "utf8");
  const shipped = b("official");
  const patched = b("patched");
  const cases = [
    [{ shipped: null, current: patched, bak: patched }, "no-archive-entry"],
    [{ shipped, current: null, bak: patched }, "missing-current"],
    [{ shipped, current: patched, bak: null }, "no-backup"],
    [{ shipped, current: patched, bak: shipped }, "already-pristine"],
    [{ shipped, current: patched, bak: b("older-official") }, "backup-differs-keep"],
    [{ shipped, current: shipped, bak: shipped }, "already-pristine"],
    [{ shipped: b("x"), current: b("x"), bak: b("x") }, "already-pristine"],
    [{ shipped: b("v2"), current: b("v1-patched"), bak: b("v1-patched") }, "repair"],
  ];
  for (const [input, want] of cases) {
    const got = repairMod.classifyBackup(input);
    if (got !== want) throw new Error(`期望 ${want}，实际 ${got}`);
  }
  return true;
});

// 10) 升级只认 tag：master 与裸 sha 不可装。
await check("升级只认 tag", async () => {
  const cases = [
    ["v1.1.72", true], ["1.1.72", true], ["v1.1.78-compat", true], ["v2.0.0-rc.1", true],
    ["master", false], ["beta", false], ["main", false],
    ["c99790cfd836aaf684e71d61a6071ff8c8dd1d25", false], ["v1.1", false], ["../v1.1.72", false],
  ];
  for (const [ref, want] of cases) {
    const got = updater.isInstallableTag(ref);
    if (got !== want) throw new Error(`isInstallableTag(${ref}) = ${got}，期望 ${want}`);
  }
  const refused = await updater.handleUpdateOp({ op: "switch", ref: "master" });
  if (refused.ok !== false || refused.disabled !== true) throw new Error("master 没有被拒绝");
  return true;
});

// 11) 自动升级必须挑「比本地新里最高的那版」，且只认 tag。
await check("自动升级挑最高版本", async () => {
  const pick = updater.pickNewestTag;
  const list = [
    { ref: "master", version: "9.9.9" },
    { ref: "v1.1.75", version: "1.1.75" },
    { ref: "v1.1.78", version: "1.1.78" },
    { ref: "v1.1.80", version: "1.1.80" },
    { ref: "v1.1.79", version: "1.1.79" },
    { ref: "abc1234", version: "1.1.99" },
    { ref: "v1.1.74", version: "1.1.74" },
  ];
  const got = pick(list, "1.1.74");
  if (!got || got.ref !== "v1.1.80") throw new Error(`期望 v1.1.80，实际 ${got && got.ref}`);
  const newerThanAll = pick(list, "1.1.80");
  if (newerThanAll !== null) throw new Error(`本地已是最新时不该有候选，实际 ${newerThanAll.ref}`);
  const onlyMaster = pick([{ ref: "master", version: "9.9.9" }], "1.1.80");
  if (onlyMaster !== null) throw new Error("master 不应被当成可安装版本");
  return true;
});

console.log("");
if (failures.length) {
  console.log(`失败 ${failures.length} 项 / ${pass} 通过`);
  for (const item of failures) console.log(`  - ${item}`);
  process.exit(1);
}
console.log(`全部通过 / ${pass} checks passed`);
