#!/usr/bin/env pwsh
<#
  dsh-purge VM 一次性验证 / one-shot verification
  在目标机（VM）里运行，输出：宿主版本、插件版本、补丁计数、换包状态、正在跑的实例。

  用法：
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\vm-verify.ps1 [-OutFile 路径] [-DshHome C:\Users\eresr\.dsh]

  只读：不改任何文件。
#>
param(
  [string]$OutFile = "",
  [string]$DshHome = ""
)

$ErrorActionPreference = "Continue"
$lines = New-Object System.Collections.Generic.List[string]
function A([string]$text = "") { $lines.Add($text) | Out-Null }

if (-not $OutFile) {
  $OutFile = Join-Path ([System.IO.Path]::GetTempPath()) ("dsh-purge-vm-verify-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".txt")
}
if (-not $DshHome) {
  if ($env:DSH_HOME) { $DshHome = $env:DSH_HOME }
  elseif (Test-Path (Join-Path $env:USERPROFILE ".dsh")) { $DshHome = Join-Path $env:USERPROFILE ".dsh" }
}

A ("dsh-purge VM verify  " + (Get-Date).ToString("s"))
A ("DSH_HOME = " + $DshHome)

# ── 1. 正在跑的实例 ─────────────────────────────────────────────
A ""
A "== 进程"
$procs = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
if (-not $procs.Count) { A "  (没有 DeepSeek Harness 进程)" }
foreach ($p in $procs) { A ("  pid=" + $p.Id + " start=" + $p.StartTime.ToString("HH:mm:ss") + " mem=" + [int]($p.WorkingSet64 / 1MB) + "MB") }

# ── 2. 插件目录版本 ────────────────────────────────────────────
A ""
A "== 插件目录"
$cands = @()
if ($DshHome) {
  $cands += (Join-Path $DshHome "profiles\desktop\node_modules\dsh-purge")
  $cands += (Join-Path $DshHome "plugins\dsh-purge")
}
foreach ($dir in $cands) {
  $pj = Join-Path $dir "package.json"
  if (Test-Path $pj) {
    try { $j = Get-Content $pj -Raw -Encoding UTF8 | ConvertFrom-Json; A ("  " + $dir + " -> " + $j.version + " / target " + $j.dshTarget) }
    catch { A ("  " + $dir + " -> package.json 解析失败") }
  } else { A ("  " + $dir + " -> (无)") }
}

# ── 3. applied.json ───────────────────────────────────────────
A ""
A "== applied.json"
$stamp = Join-Path $DshHome "dsh-purge\applied.json"
if (Test-Path $stamp) { (Get-Content $stamp -Raw -Encoding UTF8) -split "`r?`n" | ForEach-Object { A ("  " + $_) } } else { A "  (无)" }

# ── 4. 走插件自己的 HTTP 面（最真实的判据）────────────────────
A ""
A "== /dsh-purge/status"
$port = 0
$listen = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object {
  $_.LocalAddress -eq "127.0.0.1" -and ($procs | Where-Object { $_.Id -eq $_.OwningProcess })
})
foreach ($c in @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue)) {
  if ($c.LocalAddress -ne "127.0.0.1") { continue }
  if (-not ($procs | Where-Object { $_.Id -eq $c.OwningProcess })) { continue }
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $r = $client.BeginConnect("127.0.0.1", $c.LocalPort, $null, $null)
    if ($r.AsyncWaitHandle.WaitOne(600) -and $client.Connected) { $port = $c.LocalPort; $client.Close(); break }
  } catch { } finally { $client.Close() }
}
A ("  端口 / port = " + $port)
if ($port -gt 0) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $resp = Invoke-WebRequest ("http://127.0.0.1:" + $port + "/dsh-purge/status") -UseBasicParsing -TimeoutSec 120
    $doc = $resp.Content | ConvertFrom-Json
    A ("  HTTP " + $resp.StatusCode + "  用时 " + [int]$sw.Elapsed.TotalSeconds + "s")
    A ("  plugin_version = " + $doc.plugin_version)
    A ("  surface        = " + $doc.surface)
    A ("  patches        = " + $doc.patches_applied + "/" + $doc.patches_total + "  pending=" + $doc.patches_pending + "  na=" + $doc.patches_na)
    A ("  asar_sealed    = " + $doc.asar_still_sealed + "  swap_pending = " + $doc.swap_pending)
    A ("  ai_base        = " + $doc.ai_base)
    A ("  host_version?  = " + $doc.host_version)
    A "  == 非 applied 的补丁"
    $notApplied = @($doc.patches | Where-Object { $_.status -ne "applied" })
    if (-not $notApplied.Count) { A "    (全部 applied)" }
    foreach ($row in $notApplied) { A ("    #" + $row.id + "  " + $row.status) }
  } catch { A ("  ERR " + $_.Exception.Message) }
}

# ── 5. 安装目录里的 asar 与换包标记 ────────────────────────────
A ""
A "== 安装目录 resources"
$exe = $null
foreach ($p in $procs) { try { if ($p.Path -and (Test-Path $p.Path)) { $exe = $p.Path; break } } catch { } }
if (-not $exe -and $doc.ai_base) { $exe = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $doc.ai_base))) }
if ($exe) {
  $res = Join-Path (Split-Path -Parent $exe) "resources"
  A ("  exe = " + $exe)
  if (Test-Path $res) {
    Get-ChildItem $res -File -ErrorAction SilentlyContinue | ForEach-Object { A ("    " + $_.Name + "  " + $_.Length) }
    A ("    unpacked app = " + (Test-Path (Join-Path $res "app\package.json")))
  } else { A "    (没有 resources 目录)" }
} else { A "  (定位不到 exe)" }

# ── 6. 插件日志尾部 ──────────────────────────────────────────
A ""
A "== 插件日志"
foreach ($t in @((Join-Path $env:TEMP "dsh-purge-desktop.log"))) {
  if (Test-Path $t) {
    A ("  " + $t + "  mtime=" + (Get-Item $t).LastWriteTime.ToString("HH:mm:ss") + "  size=" + (Get-Item $t).Length)
    Get-Content $t -Tail 8 -Encoding UTF8 | ForEach-Object { A ("    " + $_) }
  } else { A ("  (无) " + $t) }
}

[System.IO.File]::WriteAllLines($OutFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("报告已写入 / report written: " + $OutFile)
