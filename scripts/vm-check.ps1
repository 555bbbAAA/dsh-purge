#!/usr/bin/env pwsh
<#
  dsh-purge 虚拟机自检 / VM check
  在目标机（VM）上运行，收集环境、跑自检与状态/诊断，写一份 txt 报告。

  用法：
    pwsh -File scripts\vm-check.ps1
    pwsh -File scripts\vm-check.ps1 -OutFile D:\vm-report.txt
    powershell -ExecutionPolicy Bypass -File scripts\vm-check.ps1

  只读：除 selftest 在 %TEMP% 建临时夹具外，不改宿主、不跑 apply/revert。
#>
param(
  [string]$OutFile = ""
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root "package.json"))) {
  $root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
if (-not $OutFile) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutFile = Join-Path ([System.IO.Path]::GetTempPath()) "dsh-purge-vm-report-$stamp.txt"
}

$lines = New-Object System.Collections.Generic.List[string]
function Add-Line([string]$text = "") { $lines.Add($text) | Out-Null }
function Add-Section([string]$title) {
  Add-Line ""
  Add-Line ("=" * 68)
  Add-Line "## $title"
  Add-Line ("=" * 68)
}
function Add-Cmd([string]$label, [scriptblock]$block) {
  Add-Line ""
  Add-Line "--- $label"
  try {
    $out = & $block 2>&1 | Out-String
    foreach ($line in ($out -split "`r?`n")) { Add-Line $line }
  } catch {
    Add-Line ("[ERROR] " + $_.Exception.Message)
  }
}

Add-Line "dsh-purge VM report"
Add-Line ("生成时间 / at : " + (Get-Date).ToString("s"))
Add-Line ("插件目录 / root: " + $root)

Add-Section "1. 环境 / environment"
Add-Cmd "OS" { "$([System.Environment]::OSVersion.VersionString)  $env:PROCESSOR_ARCHITECTURE" }
Add-Cmd "PowerShell" { $PSVersionTable.PSVersion.ToString() }
Add-Cmd "node" { node --version }
Add-Cmd "npm" { npm --version }
Add-Cmd "DSH_HOME" { $env:DSH_HOME }
Add-Cmd "DSH_SURFACE" { $env:DSH_SURFACE }
Add-Cmd "桌面端可执行文件" {
  $cands = @(
    "C:\Program Files\DeepSeek Harness\DeepSeek Harness.exe",
    "C:\Program Files (x86)\DeepSeek Harness\DeepSeek Harness.exe",
    (Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\DeepSeek Harness.exe")
  )
  $hit = $cands | Where-Object { Test-Path $_ }
  if ($hit) { $hit } else { "(常见目录里没有；以 --status 的『插件根』为准)" }
}
Add-Cmd "profile 里的 dsh-purge" {
  $p = Join-Path $env:DSH_HOME "profiles\desktop\package.json"
  if (Test-Path $p) { (Get-Content $p -Raw | Select-String -Pattern '"dsh-purge"\s*:\s*"[^"]+"').Matches.Value } else { "(无 profiles\desktop\package.json)" }
}

Add-Section "2. 自检 / selftest"
Add-Cmd "node scripts\selftest.mjs" { node (Join-Path $root "scripts\selftest.mjs") }

Add-Section "3. 状态 / status"
Add-Cmd "dsh-purge --status" { node (Join-Path $root "bin\dsh-purge.js") --status }

Add-Section "4. 诊断 / diag（只列未打上的）"
Add-Cmd "dsh-purge --diag" { node (Join-Path $root "bin\dsh-purge.js") --diag }

Add-Section "5. 备份完整性 / backups"
Add-Cmd "按扩展名统计 .dshpurge.bak" {
  $base = $null
  $status = node (Join-Path $root "bin\dsh-purge.js") --status 2>&1 | Out-String
  $m = [regex]::Match($status, "插件根 / root\s+(\S.*)")
  if ($m.Success) { $base = $m.Groups[1].Value.Trim() }
  if (-not $base -or -not (Test-Path $base)) { "(没解析到插件根，跳过)" ; return }
  $baks = Get-ChildItem $base -Recurse -File -Filter "*.dshpurge.bak" -ErrorAction SilentlyContinue
  $same = 0; $diff = 0
  foreach ($b in $baks) {
    $orig = $b.FullName.Substring(0, $b.FullName.Length - ".dshpurge.bak".Length)
    if (-not (Test-Path $orig)) { continue }
    $a = [System.IO.File]::ReadAllBytes($orig)
    $c = [System.IO.File]::ReadAllBytes($b.FullName)
    if ($a.Length -eq $c.Length -and (@(Compare-Object $a $c -SyncWindow 0).Count -eq 0)) { $same++ } else { $diff++ }
  }
  "备份总数 / baks      : $($baks.Count)"
  "与当前文件相同(已烧) : $same"
  "与当前文件不同(干净) : $diff"
}
Add-Cmd "重建计划 / repair-baks（只出计划）" { node (Join-Path $root "bin\dsh-purge.js") --repair-baks }

Add-Section "6. 日志尾部 / logs"
Add-Cmd "dsh-purge-desktop.log 末 40 行" {
  $log = Join-Path $env:TEMP "dsh-purge-desktop.log"
  if (Test-Path $log) { Get-Content $log -Tail 40 -Encoding UTF8 } else { "(没有这个日志)" }
}
Add-Cmd "dsh-purge-apply.log 末 40 行" {
  $log = Join-Path $env:TEMP "dsh-purge-apply.log"
  if (Test-Path $log) { Get-Content $log -Tail 40 -Encoding UTF8 } else { "(没有这个日志)" }
}

Add-Line ""
Add-Line ("报告结束 / end: " + (Get-Date).ToString("s"))
[System.IO.File]::WriteAllLines($OutFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("报告已写入 / report written: " + $OutFile)
Write-Host ("共 " + $lines.Count + " 行")
