import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { promises as fsp } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteSync, findDshHome } from "./core.js";
import { extractZipArchive } from "./zip-extract.js";

const REPO = "555bbbAAA/dsh-purge";
const STABLE_REF = "master";
const BETA_REF = "beta";
const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CHANNELS = {
  stable: { id: "stable", ref: STABLE_REF, label: "正式版" },
  beta: { id: "beta", ref: BETA_REF, label: "测试版" },
};
const COPY_NAMES = [
  "lib",
  "bin",
  "docs",
  "client.js",
  "cordis.patch.yml",
  "screenshots.json",
  "package.json",
  "README.md",
  "LICENSE",
];

const HIDDEN = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
  windowsHide: true,
  timeout: 20000,
};

// 只允许来自 GitHub / jsdelivr 的 302 跳转落地,阻挡中间人把下载指向任意主机。
const UPDATE_REDIRECT_ALLOWED_HOSTS = new Set([
  "github.com",
  "codeload.github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "cdn.jsdelivr.net",
]);
const MAX_UPDATE_BYTES = 50 * 1024 * 1024;

export function pluginRoot() {
  return PLUGIN_ROOT;
}

export function localVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8"));
    return String(pkg.version || "");
  } catch {
    return "";
  }
}

function channelStatePath() {
  return path.join(findDshHome(), "dsh-purge", "channel.json");
}

function historyPath() {
  return path.join(findDshHome(), "dsh-purge", "version-history.json");
}

function stampPath() {
  return path.join(findDshHome(), "dsh-purge", "installed-rev");
}

function autoUpdateGuardPath() {
  return path.join(findDshHome(), "dsh-purge", "auto-update-guard.json");
}

function markAutoUpdateGuard(ref, sha = "") {
  atomicWriteSync(autoUpdateGuardPath(), `${JSON.stringify({
    ref: String(ref || ""),
    sha: String(sha || ""),
    at: new Date().toISOString(),
  }, null, 2)}\n`);
}

export function normalizeChannel(value) {
  return String(value || "").toLowerCase() === "beta" ? "beta" : "stable";
}

function isBetaName(name) {
  return /(?:^|[-._])(beta|rc|pre|preview|test)(?:\d|$|[-._])/i.test(String(name || ""));
}

function withdrawnVersion(item) {
  const text = [item?.version, item?.ref, item?.id].filter(Boolean).join(" ");
  return /(?:^|[\sv])1\.1\.11-beta/i.test(String(text).replace(/^v/i, " "));
}

function splitVersion(raw) {
  const text = String(raw || "").trim().replace(/^v/i, "");
  const cut = text.split("-");
  const core = String(cut[0] || "").split(".").map((n) => parseInt(n, 10) || 0);
  return { core: [core[0] || 0, core[1] || 0, core[2] || 0], pre: cut.slice(1).join("-") };
}

/** semver 预发布段比较：数字段按数值比，数字段低于字母段。以前直接比字符串，"rc.10" 会被判成比 "rc.9" 旧。 */
function comparePrerelease(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const left = String(a).split(".");
  const right = String(b).split(".");
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const d = Number(x) - Number(y);
      if (d !== 0) return d > 0 ? 1 : -1;
      continue;
    }
    if (xNum !== yNum) return xNum ? -1 : 1;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/** 只对真正的提交号截前 7 位；apply:1.1.72 这类占位戳原样显示，别截成 "apply:1"。 */
export function shortRev(rev) {
  const text = String(rev || "").trim();
  if (!text) return "";
  return /^[0-9a-f]{7,64}$/i.test(text) ? text.slice(0, 7) : text;
}

export function versionIsNewer(remote, local) {
  if (!remote) return false;
  if (!local) return true;
  if (String(remote) === String(local)) return false;
  const a = splitVersion(remote);
  const b = splitVersion(local);
  for (let i = 0; i < 3; i += 1) {
    if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i];
  }
  return comparePrerelease(a.pre, b.pre) > 0;
}

export function latestStableVersion(versions) {
  let best = "";
  for (const item of versions || []) {
    if (!item || item.channel === "beta") continue;
    const ver = String(item.version || "").replace(/^v/i, "");
    if (!/^\d+\.\d+\.\d+/.test(ver) || isBetaName(ver)) continue;
    if (!best || versionIsNewer(ver, best)) best = ver;
  }
  return best;
}

/** 测试通道只认 beta 分支头。旧的 beta/rc/pre 标签不列出。 */
export function hideListedVersion(item, _stableVersion = "") {
  if (!item || withdrawnVersion(item)) return true;
  if (item.ref === BETA_REF && item.channel === "beta") return false;
  return item.channel === "beta" || isBetaName(item.version) || isBetaName(item.ref) || isBetaName(item.id);
}

export function readChannelState() {
  const raw = readJson(channelStatePath()) || {};
  const stored = String(raw.channel || "").toLowerCase();
  const pin = typeof raw.pin === "string" ? raw.pin.trim() : "";
  const channel = stored === "beta" ? "beta" : "stable";
  const state = {
    channel,
    pin: isBetaName(pin) || pin === BETA_REF ? "" : pin,
  };
  if ((stored === "beta") !== (channel === "beta") || state.pin !== pin) writeChannelState(state);
  return state;
}

function writeChannelState(next) {
  const state = {
    channel: normalizeChannel(next?.channel),
    pin: typeof next?.pin === "string" ? next.pin.trim() : "",
  };
  atomicWriteSync(channelStatePath(), `${JSON.stringify(state, null, 2)}\n`);
  return state;
}

export function channelPublic(state = readChannelState()) {
  const meta = CHANNELS[state.channel] || CHANNELS.stable;
  return {
    channel: meta.id,
    channelLabel: meta.label,
    pin: state.pin || "",
  };
}

function currentChannelRef(state = readChannelState()) {
  return (CHANNELS[state.channel] || CHANNELS.stable).ref;
}

function readHistory() {
  const raw = readJson(historyPath());
  const rows = Array.isArray(raw) ? raw : [];
  return rows.filter((item) => item && !withdrawnVersion(item));
}

function pushHistory(entry) {
  const next = [entry, ...readHistory().filter((item) => item && item.ref !== entry.ref)].slice(0, 20);
  atomicWriteSync(historyPath(), `${JSON.stringify(next, null, 2)}\n`);
}

/** 直连 codeload，避免 github.com/archive → 302 在 Electron/部分 Node 下变成 http 302 / fetch failed。 */
function archiveZipUrl(ref) {
  const value = String(ref || STABLE_REF);
  if (/^[0-9a-f]{40}$/i.test(value)) return `https://codeload.github.com/${REPO}/zip/${value}`;
  if (/^v?\d/.test(value)) return `https://codeload.github.com/${REPO}/zip/refs/tags/${encodeURIComponent(value)}`;
  return `https://codeload.github.com/${REPO}/zip/refs/heads/${encodeURIComponent(value)}`;
}

function archiveTarballUrl(ref) {
  const value = String(ref || STABLE_REF);
  if (/^[0-9a-f]{40}$/i.test(value)) return `https://codeload.github.com/${REPO}/tar.gz/${value}`;
  if (/^v?\d/.test(value)) return `https://codeload.github.com/${REPO}/tar.gz/refs/tags/${encodeURIComponent(value)}`;
  return `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${encodeURIComponent(value)}`;
}

function readStamp() {
  try {
    return fs.readFileSync(stampPath(), "utf8").trim();
  } catch {
    return "";
  }
}

function writeStamp(value) {
  if (!value) return;
  atomicWriteSync(stampPath(), `${value}\n`);
}

function sameRev(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export function realPath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function readJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return null;
  }
}

function isGitCheckout(dir) {
  return fs.existsSync(path.join(dir, ".git"));
}

function canGit(dir) {
  if (!isGitCheckout(dir)) return false;
  try {
    execFileSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], HIDDEN);
    return true;
  } catch {
    return false;
  }
}

function gitOk() {
  return canGit(PLUGIN_ROOT);
}

function gitHead(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], HIDDEN).trim();
  } catch {
    return "";
  }
}

export function isLinkSpec(spec) {
  const s = String(spec || "");
  return /^(link|file):/i.test(s) || s === "." || /^\.\.?(?:[/\\]|$)/.test(s);
}

export function resolveLinkDir(profileDir, spec) {
  const raw = String(spec).replace(/^(link|file):/i, "");
  return path.resolve(profileDir, raw);
}

export function findPurgeProfiles() {
  const root = path.join(findDshHome(), "profiles");
  if (!fs.existsSync(root)) return [];
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    const dir = path.join(root, name);
    const pkg = readJson(path.join(dir, "package.json"));
    const spec = pkg?.dependencies?.["dsh-purge"] || pkg?.devDependencies?.["dsh-purge"];
    if (!spec) continue;
    out.push({ name, dir, spec: String(spec) });
  }
  return out;
}

export function profilePluginDir(profileDir) {
  const nm = path.join(profileDir, "node_modules", "dsh-purge");
  return fs.existsSync(nm) ? realPath(nm) : "";
}

/** 把 profile 里的安装地址改成 codeload。github.com/archive 会 302，pnpm 的 fetch 接着失败。 */
function pinInstalledSpec(profileDir, ref) {
  if (!profileDir) return;
  const url = archiveTarballUrl(ref);
  const pkgPath = path.join(profileDir, "package.json");
  const pkg = readJson(pkgPath);
  if (pkg) {
    let changed = false;
    for (const key of ["dependencies", "devDependencies", "optionalDependencies"]) {
      if (pkg[key] && Object.prototype.hasOwnProperty.call(pkg[key], "dsh-purge") && pkg[key]["dsh-purge"] !== url) {
        pkg[key]["dsh-purge"] = url;
        changed = true;
      }
    }
    if (changed) atomicWriteSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  // 这里曾经用正则把 pnpm-lock.yaml 里 importer 的 specifier/version 两行换成新地址，
  // 却没有写 packages:/snapshots: 条目。锁文件于是自相矛盾，pnpm 在任何命令之前校验
  // 锁文件就失败：
  //   ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY / Broken lockfile: no entry for 'dsh-purge@…'
  // dsh 又给子进程带 CI=1（frozen-lockfile 默认开），于是 profile 里连紧随其后、
  // 本来能修好它的 pnpm add --force 都起不来 —— 整个 profile 从此不可安装。
  // 这个手改并不需要：pin 完 package.json 后，pnpm 自己会在 add --force 时按新地址
  // 重新解析，把 importer / packages / snapshots 一次写一致。锁文件只能由解析出这些
  // 字段的解析器来写。
}

function planUpdates() {
  const profiles = findPurgeProfiles();
  const jobs = [];
  const seen = new Set();
  const remember = (dir) => {
    const key = realPath(dir).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };

  for (const p of profiles) {
    if (isLinkSpec(p.spec)) {
      const dir = resolveLinkDir(p.dir, p.spec);
      if (!remember(dir)) continue;
      jobs.push(canGit(dir) ? { kind: "git", dir, profile: p.name } : { kind: "zip", dir, profile: p.name });
      continue;
    }
    const dir = profilePluginDir(p.dir) || PLUGIN_ROOT;
    jobs.push({ kind: "dsh", profile: p.name, spec: p.spec, dir, profileDir: p.dir });
    remember(dir);
  }

  if (!jobs.length) {
    jobs.push(canGit(PLUGIN_ROOT) ? { kind: "git", dir: PLUGIN_ROOT } : { kind: "zip", dir: PLUGIN_ROOT });
    return jobs;
  }
  if (remember(PLUGIN_ROOT)) {
    jobs.push(canGit(PLUGIN_ROOT) ? { kind: "git", dir: PLUGIN_ROOT } : { kind: "zip", dir: PLUGIN_ROOT });
  }
  return jobs;
}

function detectVia() {
  if (gitOk()) {
    const extra = findPurgeProfiles().some((p) => !isLinkSpec(p.spec));
    return extra ? "mixed" : "git";
  }
  if (findPurgeProfiles().some((p) => !isLinkSpec(p.spec))) return "dsh";
  if (findPurgeProfiles().length) return "dsh";
  return "zip";
}

function isAbortError(e) {
  const msg = String((e && e.message) || e || "");
  return (e && (e.name === "AbortError" || e.name === "TimeoutError")) || /aborted|abort|超时/i.test(msg);
}

function rewriteDownloadUrl(url) {
  const value = String(url || "");
  let match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/archive\/refs\/(tags|heads)\/(.+)\.(zip|tar\.gz)$/i);
  if (match) {
    const kind = match[4].toLowerCase() === "zip" ? "zip" : "tar.gz";
    return `https://codeload.github.com/${match[1]}/${kind}/refs/${match[2]}/${decodeURIComponent(match[3])}`;
  }
  match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/archive\/([0-9a-f]{7,40})\.(zip|tar\.gz)$/i);
  if (match) {
    const kind = match[3].toLowerCase() === "zip" ? "zip" : "tar.gz";
    return `https://codeload.github.com/${match[1]}/${kind}/${match[2]}`;
  }
  return "";
}

function requestBuffer(url, ms, headers, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      reject(e);
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      reject(new Error(`update: unsupported protocol ${parsed.protocol}`));
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const req = lib.request(parsed, {
      method: "GET",
      headers: { "user-agent": "dsh-purge-update", accept: "*/*", ...headers },
    }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error("http redirect loop"));
          return;
        }
        const loc = Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location;
        const candidate = loc ? new URL(loc, url).href : rewriteDownloadUrl(url);
        if (!candidate || candidate === url) {
          reject(new Error(`http ${status}`));
          return;
        }
        let nextUrl;
        try {
          nextUrl = new URL(candidate);
        } catch (e) {
          reject(e);
          return;
        }
        if (nextUrl.protocol !== "https:") {
          reject(new Error(`update: redirect rejected (non-https: ${nextUrl.protocol})`));
          return;
        }
        if (!UPDATE_REDIRECT_ALLOWED_HOSTS.has(nextUrl.hostname)) {
          reject(new Error(`update: redirect rejected (host not allowed: ${nextUrl.hostname})`));
          return;
        }
        requestBuffer(nextUrl.href, ms, headers, redirectsLeft - 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        res.resume();
        const rewritten = rewriteDownloadUrl(url);
        if (rewritten && rewritten !== url && redirectsLeft > 0) {
          requestBuffer(rewritten, ms, headers, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        reject(new Error(`http ${status}`));
        return;
      }
      const chunks = [];
      let received = 0;
      let aborted = false;
      res.on("data", (chunk) => {
        if (aborted) return;
        received += chunk.length;
        if (received > MAX_UPDATE_BYTES) {
          aborted = true;
          req.destroy(new Error(`update: response exceeds ${MAX_UPDATE_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (!aborted) resolve({ status, body: Buffer.concat(chunks) });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(ms, () => {
      req.destroy(new Error("GitHub 超时"));
    });
    req.end();
  });
}

async function fetchRes(url, ms = 20000, headers = {}) {
  const started = rewriteDownloadUrl(url) || url;
  try {
    const result = await requestBuffer(started, ms, headers);
    return {
      ok: true,
      status: result.status,
      async text() {
        return result.body.toString("utf8");
      },
      async arrayBuffer() {
        return result.body.buffer.slice(
          result.body.byteOffset,
          result.body.byteOffset + result.body.byteLength,
        );
      },
    };
  } catch (e) {
    if (isAbortError(e) || /GitHub 超时/.test(String(e && e.message))) throw new Error("GitHub 超时");
    throw e;
  }
}

async function fetchText(url, ms = 20000, headers = {}) {
  return (await fetchRes(url, ms, headers)).text();
}

async function fetchJson(url, ms = 20000, headers = {}) {
  return JSON.parse(await fetchText(url, ms, headers));
}

function versionFromPackageText(text) {
  const pkg = JSON.parse(text);
  return pkg && pkg.version ? String(pkg.version) : "";
}

// 远端 package.json 版本号查询:5 分钟 memo,频繁刷新面板时不重复打 raw.github / jsdelivr。
const _remotePkgVerCache = new Map();
const REMOTE_PKG_VER_TTL = 300_000;
async function remotePackageVersion(sha = "", fallbackRef = STABLE_REF) {
  const ref = sha || fallbackRef;
  const key = sha || `ref:${ref}`;
  const now = Date.now();
  const hit = _remotePkgVerCache.get(key);
  if (hit && now - hit.at < REMOTE_PKG_VER_TTL) return hit.value;
  const urls = [
    sha ? `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/package.json` : "",
    `https://raw.githubusercontent.com/${REPO}/${ref}/package.json`,
    `https://cdn.jsdelivr.net/gh/${REPO}@${ref}/package.json`,
    `https://api.github.com/repos/${REPO}/contents/package.json?ref=${encodeURIComponent(ref)}`,
  ].filter(Boolean);
  for (const url of urls) {
    try {
      if (url.includes("api.github.com/repos/")) {
        const data = await fetchJson(url, 20000, { accept: "application/vnd.github.raw" });
        let ver = "";
        if (typeof data === "string") ver = versionFromPackageText(data);
        else if (data && data.version) ver = String(data.version);
        else if (data && data.content && data.encoding === "base64") {
          ver = versionFromPackageText(Buffer.from(data.content.replace(/\s/g, ""), "base64").toString("utf8"));
        }
        if (ver) { _remotePkgVerCache.set(key, { value: ver, at: now }); return ver; }
        continue;
      }
      const ver = versionFromPackageText(await fetchText(url));
      if (ver) { _remotePkgVerCache.set(key, { value: ver, at: now }); return ver; }
    } catch {
      // 换下一个源。
    }
  }
  // 失败也记短缓存 30 秒,避免反复打空请求。
  _remotePkgVerCache.set(key, { value: "", at: now - (REMOTE_PKG_VER_TTL - 30_000) });
  return "";
}

async function remoteHeadSha(ref = STABLE_REF) {
  const target = encodeURIComponent(ref || STABLE_REF);
  const fromApi = fetchJson(`https://api.github.com/repos/${REPO}/commits/${target}`)
    .then((data) => (data?.sha ? String(data.sha) : ""))
    .catch(() => "");
  const fromAtom = fetchText(`https://github.com/${REPO}/commits/${ref}.atom`)
    .then((atom) => {
      const hit = atom.match(/<id>tag:github\.com,2008:Grit::Commit\/([0-9a-f]{40})<\/id>/);
      return hit ? hit[1] : "";
    })
    .catch(() => "");
  const [apiSha, atomSha] = await Promise.all([fromApi, fromAtom]);
  return apiSha || atomSha || "";
}

function versionLabel(version, channel, sha = "") {
  const ver = String(version || "").replace(/^v/, "") || (sha ? String(sha).slice(0, 7) : "");
  const mark = channel === "beta" ? "测试" : "正式";
  return ver ? `${ver}（${mark}）` : mark;
}

function rememberVersion(item, seen) {
  if (!item || !item.ref) return null;
  const key = `${item.sha || ""}|${item.ref}`.toLowerCase();
  if (seen.has(key)) return null;
  seen.add(key);
  return item;
}

const UPDATE_REF_RE = /^(?:v?\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?|master|main|beta|[0-9a-f]{7,40})$/i;

export function safeUpdateRef(ref) {
  const target = String(ref || "").trim();
  if (!target) return "";
  if (!UPDATE_REF_RE.test(target)) return "";
  return target;
}

export function markCurrent(versions, state, localVer, localSha) {
  const pin = String(state?.pin || "");
  const rows = versions || [];
  const ver = String(localVer || "").replace(/^v/i, "");
  const channel = state?.channel || "stable";
  const sameVersion = (item) => ver && String(item?.version || "").replace(/^v/i, "") === ver && item.channel === channel;
  const sameSha = (item) => Boolean(localSha && item?.sha && sameRev(localSha, item.sha));
  let chosen = null;
  if (pin) {
    chosen = rows.find((item) => item.ref === pin) || null;
  } else {
    const pool = rows.filter(sameVersion);
    // 安装记录里的旧提交号不能把较低版本标成当前。只认和正在跑的 package.json 相同的版本。
    chosen = pool.find((item) => sameSha(item) && (item.latest || item.ref === "master" || item.kind === "head"))
      || pool.find((item) => item.latest || item.ref === "master" || item.kind === "head")
      || pool.find((item) => sameSha(item))
      || pool[0]
      || null;
  }
  return rows.map((item) => ({
    ...item,
    shaShort: item.shaShort || (item.sha ? String(item.sha).slice(0, 7) : ""),
    current: Boolean(chosen && item === chosen),
  }));
}

async function listGithubTags() {
  try {
    const rows = await fetchJson(`https://api.github.com/repos/${REPO}/tags?per_page=50`);
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
      const name = String(row?.name || "").trim();
      if (!name || !/^v?\d+\.\d+/.test(name)) return null;
      const sha = row?.commit?.sha ? String(row.commit.sha) : "";
      const channel = isBetaName(name) ? "beta" : "stable";
      return {
        id: name,
        ref: name,
        sha,
        version: name.replace(/^v/, ""),
        channel,
        label: versionLabel(name, channel, sha),
        kind: "tag",
      };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function ensureRunningVersion(versions, state, localVer, localSha) {
  const ver = String(localVer || "").replace(/^v/i, "");
  if (!ver || isBetaName(ver) || state?.channel === "beta") return versions;
  if ((versions || []).some((item) => item.channel === "stable" && String(item.version || "").replace(/^v/i, "") === ver)) {
    return versions;
  }
  const ref = (versions || []).some((item) => item.ref === "master") ? `local-${ver}` : "master";
  return [{
    id: ref,
    ref,
    sha: localSha || "",
    version: ver,
    channel: "stable",
    label: versionLabel(ver, "stable", localSha),
    kind: "local",
    latest: !(versions || []).some((item) => item.channel === "stable" && item.latest),
  }, ...(versions || [])];
}

async function listRemoteVersions() {
  const state = readChannelState();
  const seen = new Set();
  const out = [];
  const add = (item) => {
    const next = rememberVersion(item, seen);
    if (next) out.push(next);
  };

  const [stableSha, betaSha, tags] = await Promise.all([
    remoteHeadSha(STABLE_REF),
    remoteHeadSha(BETA_REF),
    listGithubTags(),
  ]);

  if (stableSha) {
    const version = await remotePackageVersion(stableSha, STABLE_REF).catch(() => "");
    add({
      id: STABLE_REF,
      ref: STABLE_REF,
      sha: stableSha,
      version: version || "",
      channel: "stable",
      label: `${versionLabel(version, "stable", stableSha)} · 最新`,
      kind: "head",
      latest: true,
    });
  }
  if (betaSha) {
    const version = await remotePackageVersion(betaSha, BETA_REF).catch(() => "");
    add({
      id: BETA_REF,
      ref: BETA_REF,
      sha: betaSha,
      version: version || "",
      channel: "beta",
      label: `${versionLabel(version, "beta", betaSha)} · 最新`,
      kind: "head",
      latest: true,
    });
  }
  for (const tag of tags) {
    if (!withdrawnVersion(tag)) add(tag);
  }
  for (const item of readHistory()) {
    if (!item || !item.ref || withdrawnVersion(item)) continue;
    add({
      ...item,
      label: item.label || versionLabel(item.version, item.channel, item.sha),
      kind: item.kind || "history",
    });
  }

  const localVer = localVersion();
  const localSha = (gitOk() ? gitHead(PLUGIN_ROOT) : "") || readStamp();
  const withLocal = ensureRunningVersion(out, state, localVer, localSha);
  const ceiling = latestStableVersion([
    ...withLocal,
    localVer && !isBetaName(localVer) ? { channel: "stable", version: localVer } : null,
  ].filter(Boolean));
  const visible = withLocal.filter((item) => !hideListedVersion(item, ceiling));
  return {
    versions: markCurrent(visible, state, localVer, localSha),
    hasBeta: Boolean(betaSha),
    stableSha,
    betaSha: betaSha || "",
  };
}

function describeLane(id, listed, state, localVer, localRev) {
  const sha = id === "beta" ? listed.betaSha : listed.stableSha;
  const versions = listed.versions.filter((item) => item.channel === id);
  const latest = versions.find((item) => item.latest);
  const version = latest?.version || "";
  const onLane = state.channel === id;
  const matchesHead = Boolean(localRev && sha && sameRev(localRev, sha));
  const current = matchesHead || versions.some((item) => item.current && (item.latest || (state.pin && item.ref === state.pin)));
  let hasUpdate = false;
  if (onLane && state.pin) {
    hasUpdate = Boolean(sha && localRev && !sameRev(localRev, sha));
  } else if (onLane && versionIsNewer(version, localVer)) {
    // 只跟版本号。提交号对不上就再 add --force，会在 dsh 杀掉宿主后形成无限重启。
    hasUpdate = true;
  } else if (onLane && !localVer && sha && localRev && !sameRev(localRev, sha)) {
    hasUpdate = true;
  }
  return {
    id,
    ref: CHANNELS[id].ref,
    version,
    sha: sha ? String(sha).slice(0, 7) : "",
    current,
    hasUpdate,
    hasRemote: Boolean(sha || versions.length),
  };
}

function lanesOf(listed, state, localVer, localRev) {
  return {
    stable: describeLane("stable", listed, state, localVer, localRev),
    beta: describeLane("beta", listed, state, localVer, localRev),
  };
}

export async function checkUpdate() {
  let state = readChannelState();
  const localVer = localVersion();
  const listed = await listRemoteVersions();
  const gitSha = gitOk() ? gitHead(PLUGIN_ROOT) : "";
  const stamp = readStamp();
  const localRev = gitSha || stamp;
  listed.versions = markCurrent(listed.versions, state, localVer, localRev);
  const channelRef = currentChannelRef(state);
  const lanes = lanesOf(listed, state, localVer, localRev);
  const lane = lanes[state.channel] || lanes.stable;
  if (!lane.hasRemote && state.channel === "beta") {
    return rememberUpdate({
      ok: true,
      hasUpdate: false,
      hasBeta: false,
      error: "还没有测试版",
      localVersion: localVer,
      remoteVersion: "",
      localSha: shortRev(localRev),
      remoteSha: "",
      updateTarget: channelRef,
      via: detectVia(),
      versions: listed.versions,
      lanes,
      ...channelPublic(state),
    });
  }
  if (!lanes.stable.hasRemote) throw new Error("无法读取 GitHub master");
  const result = {
    ok: true,
    hasUpdate: Boolean(lane.hasUpdate),
    hasBeta: listed.hasBeta,
    updateTarget: channelRef,
    pinned: Boolean(state.pin),
    localVersion: localVer,
    remoteVersion: lane.version || lane.sha,
    localSha: shortRev(localRev),
    remoteSha: lane.sha,
    via: detectVia(),
    versions: listed.versions,
    lanes,
    ...channelPublic(state),
  };
  rememberUpdate(result);
  return result;
}

function gitTrackedDirty(dir) {
  try {
    const out = execFileSync(
      "git",
      ["-C", dir, "status", "--porcelain", "--untracked-files=no", "--", ...COPY_NAMES],
      HIDDEN,
    ).trim();
    return Boolean(out);
  } catch {
    return true;
  }
}

let lastUpdate = null;

function rememberUpdate(result) {
  lastUpdate = result && typeof result === "object" ? result : lastUpdate;
  return lastUpdate;
}

export function lastUpdateResult() {
  return lastUpdate;
}

function runGit(dir, args, timeout = 20000) {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout,
    });
  } catch (e) {
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join("\n").trim();
    throw new Error(detail || `git ${args.join(" ")}`);
  }
}

function gitResetTo(dir, ref, { force = false } = {}) {
  if (!force && gitTrackedDirty(dir)) {
    throw new Error("本地插件文件有未提交改动，未覆盖");
  }
  const target = safeUpdateRef(ref || STABLE_REF);
  if (!target) throw new Error("未知版本");
  try {
    runGit(dir, ["fetch", "origin", "--tags"], 60000);
  } catch {
    runGit(dir, ["fetch", "origin", "--tags", target], 60000);
  }
  if (target === STABLE_REF || target === BETA_REF) {
    try {
      runGit(dir, ["checkout", "-B", target, `origin/${target}`]);
      return;
    } catch {
      runGit(dir, ["reset", "--hard", `origin/${target}`]);
      return;
    }
  }
  try {
    runGit(dir, ["fetch", "origin", "--tags", target], 60000);
  } catch {
    // 上面已经 fetch 过全部分支。
  }
  runGit(dir, ["reset", "--hard", target]);
}

function extractZip(zip, dest) {
  // win32：tar(bsdtar) → powershell。darwin/linux：tar → unzip → python3 → bsdtar。
  // 外部工具都不可用时用 Node 解 zip，Linux 不会再去调用 powershell。
  extractZipArchive(zip, dest);
}

async function overlayFromZip(dests, ref = STABLE_REF) {
  const unique = [...new Set(dests.filter(Boolean).map((d) => realPath(d)))];
  if (!unique.length) return;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "dsh-purge-upd-"));
  try {
    const zip = path.join(tmp, "plugin.zip");
    const res = await fetchRes(archiveZipUrl(ref), 45000);
    await fsp.writeFile(zip, Buffer.from(await res.arrayBuffer()));
    extractZip(zip, tmp);
    const names = await fsp.readdir(tmp);
    const unpacked = names
      .map((n) => path.join(tmp, n))
      .find((p) => fs.existsSync(path.join(p, "package.json")));
    if (!unpacked) throw new Error("zip 里没有 package.json");
    for (const dest of unique) {
      for (const name of COPY_NAMES) {
        const from = path.join(unpacked, name);
        const to = path.join(dest, name);
        if (!fs.existsSync(from)) continue;
        if (name === "lib" || name === "docs" || name === "bin") {
          try {
            await fsp.rm(to, { recursive: true, force: true });
          } catch (e) {
            // 删不掉说明文件被进程占用。继续 cp 会写出一半新文件一半旧文件的半升级,
            // 让 host 和插件的版本不一致。宁可抛错让用户彻底退出宿主再重试。
            throw new Error(
              `覆盖 ${to} 失败(${e.message || e})。可能被进程占用,请完全退出宿主后重试。`,
            );
          }
        }
        await fsp.cp(from, to, { recursive: true, force: true });
      }
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function parseReapplyOutput(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.startsWith("{"))
    .pop();
  if (!line) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/** 用刚写好的插件文件在新进程里还原并重打，避免还在跑旧补丁列表。 */
function runReapplyChild() {
  const cli = path.join(PLUGIN_ROOT, "lib", "reapply-cli.js");
  if (!fs.existsSync(cli)) return { ok: false, error: "缺少重新应用脚本" };
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
  delete env.DSH_PURGE_RESTART;
  let run;
  try {
    run = spawnSync(process.execPath, ["--expose-internals", cli], {
      cwd: PLUGIN_ROOT,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  const parsed = parseReapplyOutput(`${run.stdout || ""}\n${run.stderr || ""}`);
  if (parsed) return parsed;
  const detail = String(run.stderr || run.stdout || (run.error && run.error.message) || "重新应用失败").trim();
  return { ok: false, error: detail.slice(0, 500) || "重新应用失败" };
}

let applyUpdateInflight = null;

export async function applyUpdate(jobs = planUpdates(), options = {}) {
  // 同一时刻只能有一次 applyUpdate 在跑。第二次调用在第一次完成前共享同一个 Promise,
  // 避免两条 overlayFromZip 同时往同一目录写出一半文件,或两次 writeStamp 竞争。
  if (applyUpdateInflight) return applyUpdateInflight;
  applyUpdateInflight = (async () => {
    try {
      return await _applyUpdateImpl(jobs, options);
    } finally {
      applyUpdateInflight = null;
    }
  })();
  return applyUpdateInflight;
}

async function _applyUpdateImpl(jobs, options) {
  if (!Array.isArray(jobs)) {
    options = jobs && typeof jobs === "object" ? jobs : {};
    jobs = planUpdates();
  }
  const state = readChannelState();
  const ref = safeUpdateRef(options.ref || currentChannelRef(state) || STABLE_REF);
  if (!ref) throw new Error("未知版本");
  const force = options.force !== false;
  const pin = options.pin === false ? "" : (options.pin || state.pin || "");
  const channel = normalizeChannel(options.channel || state.channel);
  const zipDirs = [];
  const specProfiles = [];
  const vias = new Set();
  for (const job of jobs) {
    if (job.kind === "git") {
      try {
        gitResetTo(job.dir, ref, { force });
        vias.add("git");
        continue;
      } catch (e) {
        if (!force && /未提交改动/.test(String(e && e.message))) throw e;
        zipDirs.push(job.dir);
      }
      continue;
    }
    if (job.kind === "dsh") {
      // exe 和 web 都走 dsh plugin add → pnpm。pnpm 拉 GitHub 包会 302 或 fetch failed，
      // 而且 add --force 会先杀掉宿主。这里改为自己下载再覆盖。
      if (job.dir) zipDirs.push(job.dir);
      if (job.profileDir) specProfiles.push(job.profileDir);
      continue;
    }
    zipDirs.push(job.dir);
  }
  if (zipDirs.length) {
    await overlayFromZip(zipDirs, ref);
    vias.add("zip");
  }
  for (const dir of specProfiles) pinInstalledSpec(dir, ref);
  const sha = (gitOk() ? gitHead(PLUGIN_ROOT) : "") || (await remoteHeadSha(ref).catch(() => ""));
  const via = vias.size > 1 ? "mixed" : [...vias][0] || detectVia();
  const saved = writeChannelState({ channel, pin });
  const localVer = localVersion();
  const listed = await listRemoteVersions().catch(() => ({ versions: [], hasBeta: saved.channel === "beta" }));
  const reapplied = runReapplyChild();
  // reapply 真的成功才能承认这次升级：写 stamp / guard / history。
  // 失败就不写,下次 checkUpdate 还能发现没完成的升级,而不是误标为"已是最新"。
  if (reapplied.ok === true) {
    if (sha) markAutoUpdateGuard(ref, sha);
    if (sha) writeStamp(sha);
    pushHistory({
      ref,
      sha: sha || "",
      version: localVer,
      channel,
      label: versionLabel(localVer, channel, sha),
      at: new Date().toISOString(),
    });
  }
  const restartAfter = reapplied.ok === true && !reapplied.needsFullQuit;
  const needsFullQuit = reapplied.ok === true && Boolean(reapplied.needsFullQuit);
  return rememberUpdate({
    ok: reapplied.ok !== false,
    applied: reapplied.ok === true,
    hasUpdate: reapplied.ok !== true,
    hasBeta: listed.hasBeta,
    pinned: Boolean(saved.pin),
    localVersion: localVer,
    remoteVersion: localVer,
    localSha: sha ? String(sha).slice(0, 7) : "",
    remoteSha: sha ? String(sha).slice(0, 7) : "",
    needRestart: false,
    reloadClient: !restartAfter && !needsFullQuit,
    restartAfter,
    needsFullQuit,
    reapplied: reapplied.ok === true,
    needsRetry: reapplied.ok === false,
    error: reapplied.ok === false ? `文件已更新，但还原并重新应用失败: ${reapplied.error || "未知错误"}` : undefined,
    via,
    versions: listed.versions,
    lanes: lanesOf(listed, saved, localVer, sha),
    ...channelPublic(saved),
  });
}

export async function switchChannel(channel, { apply = true } = {}) {
  const next = normalizeChannel(channel);
  if (!apply) {
    writeChannelState({ channel: next, pin: "" });
    return checkUpdate();
  }
  return applyUpdate(planUpdates(), { ref: CHANNELS[next].ref, channel: next, pin: false, force: true });
}

function listedUpdateRef(target, listed) {
  const safe = safeUpdateRef(target);
  if (!safe) return "";
  const hit = (listed?.versions || []).find((item) => (
    item.ref === safe
    || item.id === safe
    || item.sha === safe
    || (item.sha && safe.length >= 7 && (item.sha.startsWith(safe) || safe.startsWith(item.sha)))
  ));
  return safeUpdateRef(hit?.ref || "");
}

export async function switchVersion(ref) {
  const raw = String(ref || "").trim();
  if (withdrawnVersion({ ref: raw, version: raw })) throw new Error("该版本已下线");
  const target = safeUpdateRef(raw);
  if (!target) throw new Error("请选择要回退的版本");
  const listed = await listRemoteVersions();
  const resolved = listedUpdateRef(target, listed);
  if (!resolved) throw new Error("未知版本");
  const hit = listed.versions.find((item) => item.ref === resolved);
  const channel = hit?.channel || readChannelState().channel;
  const pin = hit?.latest ? "" : resolved;
  return applyUpdate(planUpdates(), { ref: resolved, channel, pin, force: true });
}

/**
 * 只认「自家发过的 tag」：v1.1.72、v1.1.78-compat 这类。
 * master / beta 分支与裸 sha 一律不可装 —— 面板下拉第一项取 master HEAD，
 * 那是开发中的代码，一键覆盖会把兼容修复冲掉。
 */
export function isInstallableTag(ref) {
  const value = String(ref || "").trim();
  // 允许带不带 v 前缀的版本 tag（远端真实存在与否由 handleUpdateOp 再查一次 tags 列表）。
  if (!/^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) return false;
  return safeUpdateRef(value) === value;
}

/**
 * 宿主（dsh）换了版本之后，自动从远程拉一版更新的插件。
 *
 * 只认自家发过的 tag（isInstallableTag + 远端存在），只挑比本地新的，下载走既有 applyUpdate。
 * 任何一步失败都返回 skipped/error，不抛给启动流程 —— 插件不能因为升级失败就起不来。
 */
export async function autoUpgradeForHost(options = {}) {
  const hostVersion = String(options.hostVersion || "").trim();
  const local = localVersion();
  const listed = await listRemoteVersions().catch(() => ({ versions: [] }));
  const newer = (listed.versions || [])
    .filter((item) => item && isInstallableTag(item.ref))
    .filter((item) => versionIsNewer(String(item.version || item.ref || ""), local))
    .sort((a, b) => (versionIsNewer(String(a.version || a.ref || ""), String(b.version || b.ref || "")) ? 1 : -1));
  const pick = newer[0];
  if (!pick) {
    return rememberUpdate({
      ok: true,
      auto: true,
      skipped: "no-newer-tag",
      hasUpdate: false,
      hostVersion,
      localVersion: local,
      ...channelPublic(),
    });
  }
  const ref = safeUpdateRef(pick.ref);
  if (!ref) {
    return rememberUpdate({ ok: true, auto: true, skipped: "unsafe-ref", hasUpdate: false, localVersion: local, ...channelPublic() });
  }
  const applied = await applyUpdate(planUpdates(), { ref, channel: "stable", pin: false, force: true });
  return {
    ...applied,
    auto: true,
    hostVersion,
    upgradedFrom: local,
    upgradedTo: String(pick.version || ref),
    tag: ref,
  };
}

export async function handleUpdateOp(body = {}) {
  const op = String(body.op || (body.auto ? "auto" : "apply")).toLowerCase();
  // 只读操作（看版本、看通道）随时可用。
  const READ_ONLY_OPS = new Set(["check", "status", "versions"]);
  if (READ_ONLY_OPS.has(op)) return checkUpdate();

  const tagOnlyMessage = "只允许安装自家发过的 tag（例如 v1.1.72）。面板下拉里的 master 是开发中的代码，"
    + "按此覆盖会冲掉兼容修复；要升级请用 release 资产里的 tag，或手动替换插件目录（见 INSTALL.md）。";

  // 切换通道只记状态，不装东西：允许。
  if (op === "channel") {
    const next = normalizeChannel(body.channel);
    if (body.apply === false) {
      writeChannelState({ channel: next, pin: "" });
      return checkUpdate();
    }
    return { ok: false, disabled: true, error: tagOnlyMessage, ...channelPublic() };
  }
  // auto 仍然禁用：启动路径永不自动升，版本适配依赖本机宿主。
  if (op === "auto") {
    return {
      ok: false,
      disabled: true,
      error: "已禁用启动自动升级；请在面板手动选择 tag，或替换插件目录。",
      ...channelPublic(),
    };
  }
  // switch / rollback / apply：ref 必须是远端真实存在的 tag。
  const state = readChannelState();
  const requested = String(body.ref || body.version || body.id || "").trim();
  if (!requested) {
    return { ok: false, disabled: true, error: tagOnlyMessage, ...channelPublic() };
  }
  if (!isInstallableTag(requested)) {
    return { ok: false, disabled: true, error: tagOnlyMessage, ...channelPublic() };
  }
  const listed = await listRemoteVersions().catch(() => ({ versions: [] }));
  const hit = (listed.versions || []).find((item) => String(item.ref || "").toLowerCase() === requested.toLowerCase());
  if (!hit) {
    return {
      ok: false,
      disabled: true,
      error: `远端没有这个 tag：${requested}。只能装已经发布过的版本。`,
      ...channelPublic(),
    };
  }
  const ref = safeUpdateRef(requested);
  if (!ref) throw new Error("未知版本");
  const channel = normalizeChannel(body.channel || state.channel);
  return applyUpdate(planUpdates(), { ref, channel, pin: false, force: true });
}

export async function autoUpdateIfNeeded() {
  // 插件只允许用户在面板手动更新；启动路径永不自动升（版本适配依赖本机宿主）。
  return rememberUpdate({
    auto: true,
    skipped: "manual-only",
    hasUpdate: false,
    error: "",
    ...channelPublic(),
  });
}
