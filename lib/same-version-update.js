/**
 * 同版本资产更新（按指纹判断）。
 *
 * 背景：插件只在「宿主 dsh 版本变化」时自动升级，且只认「比本地新的 tag」。
 * 现在版本号固定在 1.2、新内容用 `gh release upload --clobber` 换资产，
 * 于是 pickNewestTag 永远返回 null，自动更新不会动作。
 *
 * 这里补一条独立通路：**版本号相同也能更新** ——
 *   1. 取当前 tag（applied.json / channel.json 里的版本，形如 v1.2）
 *   2. 下载该 tag 的源码包（codeload tar.gz）并算 sha256
 *   3. 与本地记录的指纹比：不同 → 解包覆盖插件目录 → 记录新指纹 → 由调用方重启
 *
 * 只依赖 node 内建 https/zlib 与 Windows 自带 tar.exe；任何一步失败都返回 skipped/error，
 * 不抛给启动流程（插件不能因为更新失败起不来）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import https from "node:https";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginRoot = path.resolve(here, "..");
const REPO = "555bbbAAA/dsh-purge";
const UA = "dsh-purge-same-version-updater";

function log(line) {
  try {
    fs.appendFileSync(path.join(os.tmpdir(), "dsh-purge-same-version.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch { /* ignore */ }
}

function statePath(dshHome) {
  return path.join(String(dshHome || ""), "dsh-purge", "asset-fingerprint.json");
}

export function readAssetState(dshHome) {
  try {
    const fp = statePath(dshHome);
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function writeAssetState(dshHome, info) {
  const fp = statePath(dshHome);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, `${JSON.stringify(info, null, 2)}\n`, "utf8");
}

/** 跟随重定向下载，返回 Buffer。timeoutMs 内没下完就当失败。 */
function download(url, timeoutMs = 20000, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error("too many redirects"));
      return;
    }
    const req = https.get(url, { headers: { "user-agent": UA, accept: "*/*" }, timeout: timeoutMs }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        resolve(download(new URL(res.headers.location, url).href, timeoutMs, redirects + 1));
        return;
      }
      if (code !== 200) {
        res.resume();
        reject(new Error(`HTTP ${code} for ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

export function tagFromVersion(version) {
  const v = String(version || "").trim();
  if (!v) return "";
  return v.startsWith("v") ? v : `v${v}`;
}

/** 远端该 tag 的源码包指纹（缓存到内存，避免启动时重复下载）。 */
let fingerprintCache = null;

export async function remoteFingerprint(tag) {
  if (fingerprintCache && fingerprintCache.tag === tag) return fingerprintCache;
  const url = `https://codeload.github.com/${REPO}/tar.gz/refs/tags/${encodeURIComponent(tag)}`;
  const buf = await download(url, 30000);
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  fingerprintCache = { tag, sha256, bytes: buf.length, url, at: new Date().toISOString() };
  return fingerprintCache;
}

function extractTarGz(buf, destDir) {
  const tmp = path.join(os.tmpdir(), `dsh-purge-same-${Date.now()}.tar.gz`);
  fs.writeFileSync(tmp, buf);
  try {
    fs.mkdirSync(destDir, { recursive: true });
    execFileSync("tar.exe", ["-xzf", tmp, "-C", destDir, "--strip-components=1"], {
      windowsHide: true,
      timeout: 60000,
      stdio: "ignore",
    });
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
  }
}

function targets(dshHome) {
  const out = [];
  if (!dshHome) return out;
  out.push(path.join(dshHome, "profiles", "desktop", "node_modules", "dsh-purge"));
  out.push(path.join(dshHome, "plugins", "dsh-purge"));
  return out;
}

/**
 * 主入口：同版本按指纹更新。
 * @param {object} opts { dshHome, localVersion, enabled, dryRun }
 * @returns {Promise<object>} { action: "skipped"|"up-to-date"|"updated"|"error", ... }
 */
export async function sameVersionAssetUpdate(opts = {}) {
  const dshHome = String(opts.dshHome || "").trim();
  if (!dshHome) return { action: "skipped", reason: "no-dsh-home" };
  if (opts.enabled === false) return { action: "skipped", reason: "disabled" };
  const tag = tagFromVersion(opts.localVersion || "");
  if (!tag) return { action: "skipped", reason: "no-version" };
  // 节流：默认 6 小时查一次，避免每次启动都下载整包算指纹
  try {
    const prev = readAssetState(dshHome);
    const everyMs = Number(opts.intervalMs || 6 * 60 * 60 * 1000);
    const lastCheck = prev && prev.checkedAt ? Date.parse(prev.checkedAt) : 0;
    if (!opts.force && lastCheck && Date.now() - lastCheck < everyMs) {
      return { action: "skipped", reason: "throttled", tag };
    }
    if (!opts.force && prev && !prev.checkedAt) {
      writeAssetState(dshHome, { ...prev, checkedAt: new Date().toISOString() });
      return { action: "skipped", reason: "baseline-recorded", tag };
    }
  } catch { /* ignore */ }
  try {
    const remote = await remoteFingerprint(tag);
    const local = readAssetState(dshHome);
    if (opts.dryRun) {
      return {
        action: local && local.sha256 === remote.sha256 ? "up-to-date" : "would-update",
        tag,
        local_sha256: local ? local.sha256 : "",
        remote_sha256: remote.sha256,
      };
    }
    // 首次运行只记基线，不安装（避免刚装好就从远端重下一遍）
    if (!local) {
      writeAssetState(dshHome, { tag, sha256: remote.sha256, bytes: remote.bytes, at: new Date().toISOString(), checkedAt: new Date().toISOString(), dirs: [], baseline: true });
      log(`记录基线指纹 tag=${tag} sha=${remote.sha256.slice(0, 12)}`);
      return { action: "baseline-recorded", tag, sha256: remote.sha256 };
    }
    if (local.sha256 === remote.sha256) {
      try { writeAssetState(dshHome, { ...local, checkedAt: new Date().toISOString() }); } catch { /* ignore */ }
      return { action: "up-to-date", tag, sha256: remote.sha256 };
    }
    log(`发现同版本资产变化 tag=${tag} local=${local ? local.sha256.slice(0, 12) : "(none)"} remote=${remote.sha256.slice(0, 12)}`);
    const buf = await download(remote.url, 60000);
    const dirs = targets(dshHome);
    const installed = [];
    for (const dir of dirs) {
      try {
        extractTarGz(buf, dir);
        installed.push(dir);
      } catch (e) {
        log(`解包失败 ${dir}: ${e && (e.message || e)}`);
      }
    }
    if (installed.length === 0) {
      writeAssetState(dshHome, { tag, sha256: remote.sha256, at: new Date().toISOString(), failed: true });
      return { action: "error", reason: "extract-failed", tag };
    }
    writeAssetState(dshHome, {
      tag,
      sha256: remote.sha256,
      bytes: remote.bytes,
      at: new Date().toISOString(),
      dirs: installed,
    });
    log(`已更新 ${installed.length} 处目录，记录指纹 ${remote.sha256.slice(0, 12)}`);
    return { action: "updated", tag, sha256: remote.sha256, dirs: installed };
  } catch (e) {
    log(`同版本更新失败: ${e && (e.message || e)}`);
    return { action: "error", reason: String(e && (e.message || e)) };
  }
}
