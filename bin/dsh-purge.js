#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import * as core from "../lib/core.js";
import * as rules from "../lib/rules.js";

const args = process.argv.slice(2);

function printStatus(state) {
  const out = [];
  out.push("dsh-purge 状态 / Status");
  out.push("  宿主 / surface " + (state.surface || "web"));
  out.push("  DSH_HOME      " + state.dsh_home);
  if (state.desktop_install) out.push("  桌面安装       " + state.desktop_install);
  if (state.ai_base) {
    out.push("  插件根 / root  " + state.ai_base);
    for (const [key, fp] of Object.entries(state.files)) {
      out.push(`    ${key.padEnd(22)} ${fp}`);
    }
  } else {
    out.push("  插件根 / root  " + core.missingAiBaseMessage());
  }
  out.push(`  shim 目录      ${state.shim_dir || "未定位 / not found"}`);
  out.push(`  备份 / backup  ${state.has_backup ? "有 / yes" : "无 / no"}`);
  out.push(`  注入文件       ${state.override_path}`);
  out.push(`  注入状态       ${state.override_status}`);
  out.push("");
  // 两套口径并存，必须写明，否则 71/82 与面板上的 61/66 会被当成矛盾。
  // 82 = ALL_PATCHES 完整表；面板把同一批补丁按显示分组折叠后计数，分母更小。
  const applicable = core.ALL_PATCHES.filter((p) => state.patch_status[p.id] !== "na").length;
  out.push(`  补丁 ${state.patches_applied}/${core.ALL_PATCHES.length} 已清洗, ${state.patches_pending} 待清洗`);
  out.push(`      口径：完整表 ${core.ALL_PATCHES.length} 条，其中 ${applicable} 条在当前布局适用`);
  out.push("      面板与命令行现已同一口径（完整表）；分组数字另存 patches_*_grouped 供折叠视图使用");
  for (const p of core.ALL_PATCHES) {
    const s = state.patch_status[p.id];
    const mark = s === "applied" ? "✓" : s === "pending" ? "✗" : "·";
    out.push(`    ${mark} [#${String(p.id).padEnd(2)}] ${p.name.padEnd(30)} ${p.layer}/${p.layer_en} — ${s}`);
  }
  out.push("");
  out.push(`  shim: dsh.cmd=${state.shim_cmd}  dsh.ps1=${state.shim_ps1}  dsh=${state.shim_bin}`);
  // bundle 声明了却解析不到时，宿主会静默跳过整条插件——界面完全看不出来。
  for (const issue of core.bundleRegistrationIssues(state.dsh_home)) {
    out.push("");
    out.push(`  ⚠ profile「${issue.profile}」声明了 dsh-purge 但解析不到`);
    out.push(`    dependencies: ${issue.dependency || "(空)"}   node_modules: ${issue.modulePresent ? "有" : "缺失"}`);
    out.push("    宿主会静默跳过这个 bundle，插件等于没装。修复：");
    out.push(`    ${issue.fix}`);
  }
  return out.join("\n");
}

async function main() {
  const mode = args.find((a) => ["--apply", "--revert", "--uninstall", "--status", "--edit", "--swap-asar", "--diag", "--fix-shim", "--help"].includes(a));

  if (mode === "--help" || args.includes("-h")) {
    console.log(`dsh-purge 用法:
  dsh-purge --status     显示状态
  dsh-purge --apply      应用全部清洗（提示词+代码+shim+override）
  dsh-purge --revert     回滚还原
  dsh-purge --uninstall  卸载插件（已应用则先还原）
  dsh-purge --edit       编辑注入文件 prompt-inject.md
  dsh-purge --swap-asar  离线换包：应用完全退出后挪开 app.asar 并重新打开
                         加 --no-start 只换包不启动
                         加 --force   跳过归档身份比对（默认比对不上会拒绝，改用 --apply）
  dsh-purge --diag       逐条逐文件诊断：为什么这条补丁没打上
                         加 --diag=all 连 applied 的也列出来
  dsh-purge --fix-shim   生成 dsh.cmd / dsh.ps1 到 <DSH_HOME>/bin，解决换包后 CLI 失效
  dsh-purge --help       帮助`);
    return;
  }

  const state = await core.gatherState();
  console.log(printStatus(state));
  console.log("");

  if (mode === "--apply") {
    if (!state.ai_base) {
      console.log("[ERROR] " + core.missingAiBaseMessage());
      console.log("  fix: 把 DSH_BASE 指到含 dsh-agent-instructions/lib 的 @deepseek-ai 目录");
      process.exit(1);
    }
    const inject = rules.resolveInjectText(state.dsh_home);
    if (!inject.text) {
      console.log("[ERROR] 提示词和规则集都是空的，必须先添加提示词");
      process.exit(1);
    }
    const { hosts, report } = await core.applyPatchesAllHosts(core.ALL_PATCHES, {
      preserveClientBundles: false,
      forApply: true,
    });
    for (const h of hosts) console.log(`  宿主 / host → ${h.aiBase}`);
    for (const r of report) {
      const m = r.status === "applied" ? "✓ 已清洗" : r.status === "already" ? "- 已是最新" : r.status === "missing_file" ? "⚠ 文件缺失" : `✗ ${r.status}`;
      console.log(`  ${m} patch #${String(r.patch_id).padEnd(2)} ${r.name}`);
    }
    const flashHost = hosts[0]?.aiBase || state.ai_base;
    const flash = core.silenceCmdFlash(flashHost);
    console.log(`  cmd-flash=${flash.entry} phase-1=${flash.phase1} ok=${flash.ok}`);
    // 密封 asar 存在 = Electron 加载的是 app.asar，写在 resources/app 里的补丁全被遮蔽。
    // 这种状态下补丁「写了但不生效」，退出码必须是失败，否则脚本和 CI 会当成已完成。
    let sealedAsar = "";
    if (state.desktop_install) {
      try {
        const desktop = await import("../lib/desktop.js");
        const asar = desktop.appAsarPath(state.desktop_install);
        if (asar && (await import("node:fs")).existsSync(asar)) sealedAsar = asar;
      } catch {
        /* 定位失败不影响主流程 */
      }
    }
    if (hosts.length > 1) {
      console.log(`  多宿主 / multi-host: ${hosts.length} 份 @deepseek-ai 已清洗`);
    }
    console.log(inject.source === "rule"
      ? "  - 使用当前规则集，不改写提示词文件"
      : "  - 使用已有提示词文件");
    if (state.shim_dir) {
      const r = await core.patchShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "patched") console.log(`  ✓ shim ${fname} 注入 / injected`);
        else if (st === "already_patched") console.log(`  - shim ${fname} 已注入 / already injected`);
        else if (st === "missing") console.log(`  - shim ${fname} 不存在 / missing`);
        else console.log(`  ⚠ shim ${fname}: ${st}`);
      }
    } else {
      console.log("  ⚠ 未定位 shim 目录，跳过注入");
    }
    console.log("");
    if (sealedAsar) {
      // 补丁确实写进了 resources/app，但 Electron 读的是 app.asar，所以「写了等于没写」。
      // 退出码必须非 0：脚本/CI 只看退出码，返回 0 会被当成已完成（现场实测踩过）。
      console.log("⚠ 未生效 / NOT IN EFFECT：app.asar 仍是密封的");
      console.log(`    ${sealedAsar}`);
      console.log("    补丁已写入 resources\\app，但 Electron 现在读的是 app.asar，补丁被遮蔽。");
      console.log("    下一步（二选一）：");
      console.log("      A. 在插件面板再点一次「应用」——它会自动解包、换包、重启");
      console.log("      B. 完全退出应用后执行 dsh-purge --swap-asar，再打开应用");
      console.log("");
      console.log("exit code 3 = 补丁已写但未生效 / written but not active");
      process.exit(3);
    }
    console.log("全部完成 / All done。重启 dsh 生效 / Restart dsh to take effect.");
  } else if (mode === "--revert") {
    if (state.ai_base || core.enumeratePatchAiBases().length) {
      const { reverted, errors } = await core.revertAllHosts();
      for (const p of reverted) console.log(`  ✓ 已还原 / Reverted ${p}`);
      for (const [p, e] of errors) console.log(`  ⚠ 还原失败 ${p}: ${e}`);
      if (reverted.length === 0) console.log("  - 没有补丁备份可还原 / no patch backup");
    }
    if (state.shim_dir) {
      const r = await core.revertShim(state.shim_dir);
      for (const [fname, st] of Object.entries(r)) {
        if (st === "reverted" || st === "stripped_inject") console.log(`  ✓ shim ${fname}: ${st}`);
        else console.log(`  - shim ${fname}: ${st}`);
      }
    }
    console.log("");
    console.log("回滚完成 / Revert done。重启 dsh 后恢复 / restart to restore.");
    console.log("注: prompt-inject.md 保留（用户文件）/ prompt-inject.md kept (user file)");
  } else if (mode === "--uninstall") {
    const { uninstallPurge } = await import("../lib/uninstall.js");
    const result = await uninstallPurge();
    if (result.applied) console.log("  已检测到补丁，已还原回原版。");
    else console.log("  未检测到已应用补丁，仍会清除插件文件。");
    if (result.override?.removed) console.log(`  已删除 ${result.override.path}`);
    if (result.stripped?.length) console.log(`  已从 profile 移除: ${result.stripped.join(", ")}`);
    for (const e of result.errors || []) console.log(`  ⚠ ${e}`);
    if (!result.ok) {
      console.log("  卸载中止：还原失败，插件文件未删除。");
      process.exit(1);
    }
    console.log("");
    console.log("卸载完成。请重启 dsh。");
  } else if (mode === "--swap-asar") {
    const desktop = await import("../lib/desktop.js");
    const exeArgIdx = args.indexOf("--exe");
    const exeArg = exeArgIdx >= 0 ? args[exeArgIdx + 1] : "";
    const exe = exeArg || state.desktop_install || desktop.findDesktopAppExecutable() || "";
    if (!exe) {
      console.log("[ERROR] 找不到桌面端可执行文件，用 --exe 指定");
      process.exit(1);
    }
    const asar = desktop.appAsarPath(exe);
    console.log(`  桌面安装  ${exe}`);
    console.log(`  app.asar  ${asar}`);
    // 归档身份比对：官方更新会把一份新的 app.asar 写回来，而上一版的 resources/app 还在。
    // 只改名不解包 → Electron 加载的仍是旧解包树，看着"更新了"，实际跑的是旧构建。
    // 这种情况必须走 --apply（它会按 asar 身份重新解包再洗），不能靠 --swap-asar。
    const force = args.includes("--force");
    let staleTree = "";
    if (fs.existsSync(asar)) {
      try {
        const { asarFileIdentity, sameAsarIdentity } = await import("../lib/extract-asar.js");
        const ident = asarFileIdentity(asar);
        const stamp = core.readUnpackedAsarStamp();
        const appDir = path.join(path.dirname(asar), "app");
        if (ident && fs.existsSync(appDir) && (!stamp || !sameAsarIdentity(ident, stamp))) staleTree = appDir;
      } catch {
        /* 身份读不出来就按老路走，不让比对本身挡住换包 */
      }
    }
    if (staleTree && !force) {
      console.log("  ✗ 归档和现有解包树对不上：这份 app.asar 不是当初解包的那一份");
      console.log(`    解包树 ${staleTree}`);
      console.log("    只改名不解包，Electron 还会加载旧的解包树，等于没更新。改用：");
      console.log("      dsh-purge --apply      (按 asar 身份重新解包，再洗补丁)");
      console.log("    确实要只改名（比如只是挪开同一份归档）时加 --force。");
      process.exit(4);
    }
    if (staleTree && force) console.log("  ! --force：跳过身份比对，解包树可能不是这份归档的内容");
    const start = !args.includes("--no-start");
    const r = await desktop.swapAsarOffline({ exe, asar, start });
    if (r.ok) {
      if (r.already) {
        console.log("  - 已经是解包态，无需换包 / already unsealed");
      } else {
        console.log(`  ✓ 已挪开 app.asar → ${r.bak}`);
        console.log("  ✓ resources/app 会在下次启动时被加载");
      }
      if (r.started) console.log("  ✓ 已重新打开应用");
      else if (start) console.log("  - 未自动打开，请手动启动");
    } else if (r.error === "app_running") {
      console.log("  ✗ 应用还在运行");
      console.log("  " + (r.hint || ""));
      process.exit(2);
    } else {
      console.log(`  ✗ 换包失败: ${r.error}`);
      if (r.hint) console.log("  " + r.hint);
      process.exit(1);
    }
  } else if (mode === "--diag") {
    if (!state.ai_base) {
      console.log("[ERROR] " + core.missingAiBaseMessage());
      process.exit(1);
    }
    const showAll = args.includes("--diag=all") || args.includes("--all");
    const { rows, counts } = await core.diagnosePatches(state.ai_base);
    console.log("插件根 / root  " + state.ai_base);
    console.log("");
    for (const row of rows) {
      if (!showAll && row.status === "applied") continue;
      console.log(`#${String(row.id).padEnd(3)} ${row.name.padEnd(32)} ${row.status}`);
      for (const f of row.files || []) {
        const short = f.path ? f.path.replace(state.ai_base + "\\", "").replace(state.ai_base + "/", "") : "(no path)";
        const bits = [`outcome=${f.outcome}`];
        if (f.bytes != null) bits.push(`bytes=${f.bytes}`);
        if (f.markerTotal) bits.push(`marker=${f.markerHit}/${f.markerTotal}`);
        if (f.remaining != null) bits.push(`needle_hit=${f.remaining}`);
        console.log(`      ${short}   ${bits.join("  ")}`);
        if (f.hitPatterns?.length) {
          for (const s of f.hitPatterns) console.log(`        ↳ 命中: ${s}`);
        }
        if (f.detail) console.log(`        ↳ ${f.detail}`);
      }
    }
    console.log("");
    console.log("统计 / summary: " + JSON.stringify(counts));
    console.log("");
    console.log("判读 / how to read:");
    console.log("  pending + needle_hit>0  → 原文还在，pattern 没替换干净（可能换行截断或只替了一处）");
    console.log("  pending + needle_hit=0  → 原文找不到但也没标记，通常是路径指向了别的树");
    console.log("  skipped                 → 这份文件里本来就没有该原文，属正常");
    console.log("  missing_file            → 包目录不存在，版本布局不同");
  } else if (mode === "--fix-shim") {
    const r = await core.installCliShim(state.dsh_home);
    if (!r.ok) {
      console.log(`[ERROR] 生成 shim 失败: ${r.error}`);
      process.exit(1);
    }
    console.log(`  ✓ 已生成 ${r.written.join(" / ")}`);
    console.log(`    目录: ${r.binDir}`);
    console.log(`    CLI : ${r.cli.app}`);
    console.log(`          （不存在时回退到 ${r.cli.asar}）`);
    console.log("");
    console.log("  把它加进 PATH 即可直接使用 dsh 命令。");
    console.log("  注意：必须只读写 User 作用域，直接用 $env:Path 会把机器级路径复制进用户 PATH（污染）。");
    console.log("");
    console.log("  永久生效（幂等，已存在则跳过）：");
    console.log(`    $u=[Environment]::GetEnvironmentVariable('Path','User'); if (";$u;" -notlike "*;${r.binDir};*") { [Environment]::SetEnvironmentVariable('Path', (($u -replace ';+$','') + ';${r.binDir}'), 'User') }`);
    console.log("");
    console.log("  当前会话临时生效：");
    console.log(`    if (";$env:Path;" -notlike "*;${r.binDir};*") { $env:Path += ";${r.binDir}" }`);
  } else if (mode === "--edit") {
    const r = core.editOverride(state.dsh_home);
    if (!r.ok && r.needCreate) {
      await core.installOverride(state.dsh_home, true);
      console.log(`  ✓ 已创建默认注入文件：${state.override_path}`);
      core.editOverride(state.dsh_home);
    } else {
      console.log(`  → 已打开 ${r.editor} 编辑注入文件：${r.path}`);
    }
    console.log("  编辑完成后重启 dsh 生效。");
  } else {
    console.log("默认不清洗，使用 --apply 应用清洗。");
  }
}

main().catch((e) => {
  console.error("[dsh-purge] error:", e);
  process.exit(1);
});
