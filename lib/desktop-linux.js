// Linux 宿主定位：替代 Windows 侧的注册表 / Win32_Process / 快捷方式三条路径。
// 目标宿主：DeepSeek Harness 桌面版（Electron），Linux 上常见形态有三种 ——
// ① AppImage 单文件（挂载到 /tmp/.mount_*）② 解包目录（/opt 或 ~/.local）③ deb/rpm 安装（/usr/lib）。
// 只读探测，不写任何文件；所有函数失败时返回空数组，由调用方降级。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXE_NAMES = [
  "deepseek-harness",
  "deepseek harness",
  "dsh-desktop",
  "dsh desktop",
];

function isFile(fp) {
  try {
    return fs.statSync(fp).isFile();
  } catch {
    return false;
  }
}

function isDir(fp) {
  try {
    return fs.statSync(fp).isDirectory();
  } catch {
    return false;
  }
}

function uniquePaths(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const v = String(raw || "").trim();
    if (!v) continue;
    const key = v.replace(/\/+$/, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/** 判断一个路径是否是目标宿主的可执行文件（按 basename 匹配，忽略大小写）。 */
export function isLinuxHarnessExecutable(fp) {
  const base = path.basename(String(fp || "")).toLowerCase();
  if (!base) return false;
  if (EXE_NAMES.includes(base)) return true;
  // AppImage 常见命名：DeepSeek_Harness-0.2.1.AppImage / deepseek-harness-x86_64.AppImage
  if (/^deepseek[\s._-]*harness.*\.appimage$/i.test(base)) return true;
  if (/^dsh[\s._-]*desktop.*\.appimage$/i.test(base)) return true;
  return /^deepseek[\s._-]*harness$/.test(base);
}

/**
 * 从 /proc 读运行中的宿主进程可执行路径。
 * /proc/<pid>/exe 是指向真实二进制的符号链接，readlink 即可拿到绝对路径。
 * AppImage 运行时 exe 会指向 /tmp/.mount_XXX 下的解包副本，这里同时返回
 * /proc/<pid>/cmdline 里的原始 AppImage 路径，两者都保留由调用方取舍。
 */
export function linuxRunningExecutables() {
  const found = [];
  let pids = [];
  try {
    pids = fs.readdirSync("/proc").filter((name) => /^\d+$/.test(name));
  } catch {
    return [];
  }
  for (const pid of pids) {
    const base = `/proc/${pid}`;
    // 1) exe 符号链接
    try {
      const exe = fs.readlinkSync(path.join(base, "exe"));
      const clean = exe.replace(/\s+\(deleted\)$/, "");
      if (isLinuxHarnessExecutable(clean)) found.push(clean);
    } catch {
      /* 权限不足或进程已退出 */
    }
    // 2) cmdline 里的原始路径。两种情况都要覆盖：
    //    a. AppImage：exe 指向 /tmp/.mount_XXX 的解包副本，cmdline 里才是 .AppImage 本体
    //    b. 解释器脚本 / 符号链接：exe 指向 /usr/bin/dash 之类，cmdline 里才是真实入口
    try {
      const raw = fs.readFileSync(path.join(base, "cmdline"), "utf8");
      for (const arg of raw.split("\0")) {
        const v = String(arg || "").trim();
        if (!v) continue;
        if (!v.includes("/")) continue;
        if (isLinuxHarnessExecutable(v)) found.push(v);
      }
    } catch {
      /* ignore */
    }
  }
  return uniquePaths(found).filter((fp) => isFile(fp));
}

/** 解析 .desktop 文件里的 Exec= 行，取出可执行路径。 */
function execFromDesktopFile(fp) {
  let text = "";
  try {
    text = fs.readFileSync(fp, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*Exec\s*=\s*(.+)$/i.exec(line);
    if (!m) continue;
    // 去掉 %U %F %f %u 这类占位符，再按空白切分，取第一个看起来像路径的 token
    const cleaned = m[1].replace(/%[a-zA-Z]/g, " ").trim();
    for (const token of cleaned.split(/\s+/)) {
      const v = token.replace(/^["']|["']$/g, "");
      if (!v) continue;
      if (isLinuxHarnessExecutable(v)) out.push(v);
      else if (v.includes("/") && isLinuxHarnessExecutable(path.basename(v))) out.push(v);
    }
  }
  return out;
}

/** 从 .desktop 文件找宿主可执行文件。覆盖系统级与用户级 applications 目录。 */
export function linuxShortcutExecutables() {
  const home = os.homedir();
  const roots = [
    "/usr/share/applications",
    "/usr/local/share/applications",
    "/var/lib/flatpak/exports/share/applications",
    path.join(home, ".local/share/applications"),
    path.join(home, ".local/share/flatpak/exports/share/applications"),
  ];
  const found = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(root).filter((n) => n.toLowerCase().endsWith(".desktop"));
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/deepseek|harness|dsh/i.test(name)) continue;
      found.push(...execFromDesktopFile(path.join(root, name)));
    }
  }
  return uniquePaths(found).filter((fp) => isFile(fp));
}

/**
 * 常见安装目录。只探固定候选，不做全盘扫描。
 * 返回的是「目录」，调用方会在里面找可执行文件。
 */
export function linuxInstallDirs(env = process.env) {
  const home = os.homedir();
  const names = ["deepseek-harness", "DeepSeek Harness", "dsh-desktop", "DSH Desktop", "deepseek-harness-desktop"];
  const roots = [
    "/opt",
    "/usr/lib",
    "/usr/local/lib",
    "/usr/share",
    path.join(home, ".local/share"),
    path.join(home, ".local/opt"),
    path.join(home, "Applications"),
    path.join(home, "opt"),
    path.join(home, "Downloads"),
    path.join(home, "Desktop"),
  ];
  const cands = [];
  for (const root of roots) {
    for (const name of names) cands.push(path.join(root, name));
  }
  // DSH_HOME / DSH_BASE 附近
  for (const key of ["DSH_HOME", "DSH_BASE"]) {
    const raw = env[key];
    if (!raw) continue;
    try {
      const start = path.normalize(String(raw));
      cands.push(start, path.dirname(start), path.dirname(path.dirname(start)));
    } catch {
      /* ignore */
    }
  }
  return uniquePaths(cands).filter((dir) => isDir(dir));
}

/**
 * 在给定目录里找宿主可执行文件；也接受直接传入 AppImage 文件路径。
 * 返回可执行文件的绝对路径，找不到返回空串。
 */
export function firstLinuxHarnessExecutable(dirs) {
  for (const raw of dirs || []) {
    const dir = String(raw || "").trim();
    if (!dir) continue;
    if (isFile(dir) && isLinuxHarnessExecutable(dir)) return dir;
    if (!isDir(dir)) continue;
    for (const name of EXE_NAMES) {
      const fp = path.join(dir, name);
      if (isFile(fp)) return fp;
    }
    // AppImage 散落在目录里
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/\.appimage$/i.test(name)) continue;
      const fp = path.join(dir, name);
      if (isFile(fp) && isLinuxHarnessExecutable(fp)) return fp;
    }
  }
  return "";
}

/**
 * AppImage 的 resources 目录：AppImage 运行时挂载在 /tmp/.mount_<name>/resources，
 * 解包安装则在 <install>/resources。这里从可执行文件路径推断。
 */
export function linuxResourcesDir(exe) {
  const fp = String(exe || "").trim();
  if (!fp) return "";
  const dir = path.dirname(fp);
  // 解包安装：<install>/resources/app.asar 存在
  const direct = path.join(dir, "resources");
  if (isDir(direct)) return direct;
  // AppImage：exe 在挂载根，resources 同级
  if (dir.includes("/tmp/.mount_") || dir.includes("/.mount_")) {
    if (isDir(direct)) return direct;
  }
  // 可执行文件在 <install>/bin 下时上跳一层
  const up = path.join(path.dirname(dir), "resources");
  if (isDir(up)) return up;
  return "";
}
