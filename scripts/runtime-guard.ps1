# dsh runtime 守卫（1.2.16）
# 在「宿主启动之前」把 resources\runtime 补齐 —— 不依赖 dsh-purge 是否被 bundles 加载。
# 官方安装器/更新器有时会把 resources\runtime 清空（目录还在、0 个条目），
# 而 dsh-base 加载 dsh-skill-office 时就要读 runtime\office-skills\office\SKILL.md，
# 缺了就是启动即崩。2026-10-25 那次事故就是这么来的。
# 运行方式：登录时由 Startup 里的 dsh-runtime-guard.vbs 隐藏拉起；也可手动双击。
#
# 2026-10-26 修的三个坑：
#   ① 变量名不能用 $home —— PowerShell 里 $HOME 是只读自动变量，赋值静默失败、
#      脚本会继续跑但补齐源变成 C:\Users\<用户>\plugins\... （实测「fail: runtime-min source not found」）
#   ② 注册表键名不是 deepseek-harness，真实键是 GUID；改成按 DisplayName 枚举
#   ③ 拷贝改成「只补缺失」，不再 -Force 覆盖（避免把官方新文件盖成 runtime-min 旧版）
$ErrorActionPreference = 'Continue'
$stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
$logPath = Join-Path $env:TEMP 'dsh-purge-runtime-guard.log'
function W($m) { try { Add-Content -LiteralPath $logPath -Value ($stamp + ' ' + $m) -Encoding UTF8 } catch {} }

function Find-InstallDir {
  # 测试用覆盖
  if ($env:DSH_PURGE_INSTALL_DIR) { return $env:DSH_PURGE_INSTALL_DIR }
  foreach ($root in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
                      'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall')) {
    try {
      foreach ($k in (Get-ChildItem $root -ErrorAction SilentlyContinue)) {
        $props = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
        if (-not $props) { continue }
        if (-not ($props.DisplayName -like '*DeepSeek*')) { continue }
        $loc = $props.InstallLocation
        if ($loc -and (Test-Path (Join-Path $loc 'DeepSeek Harness.exe'))) { return $loc }
      }
    } catch {}
  }
  foreach ($p in @("$env:LOCALAPPDATA\Programs\DeepSeek Harness", 'I:\deepseek', 'C:\Program Files\DeepSeek Harness')) {
    if (Test-Path (Join-Path $p 'DeepSeek Harness.exe')) { return $p }
  }
  return ''
}

function Copy-Missing($from, $to) {
  if (-not (Test-Path $from)) { return 0 }
  $n = 0
  if (Test-Path $from -PathType Container) {
    New-Item -ItemType Directory -Force -Path $to | Out-Null
    foreach ($item in (Get-ChildItem -LiteralPath $from -Force -ErrorAction SilentlyContinue)) {
      $dst = Join-Path $to $item.Name
      if (Test-Path $dst) {
        if ($item.PSIsContainer) { $n += (Copy-Missing $item.FullName $dst) }
        continue
      }
      if ($item.PSIsContainer) {
        New-Item -ItemType Directory -Force -Path $dst | Out-Null
        $n += (Copy-Missing $item.FullName $dst)
      } else {
        try { Copy-Item -LiteralPath $item.FullName -Destination $dst -ErrorAction Stop; $n += 1 } catch {}
      }
    }
  } else {
    $parent = Split-Path -Parent $to
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    if (-not (Test-Path $to)) { try { Copy-Item -LiteralPath $from -Destination $to -ErrorAction Stop; $n += 1 } catch {} }
  }
  return $n
}

$install = Find-InstallDir
if (-not $install) { W 'skip: install dir not found'; exit 0 }
$runtime = Join-Path $install 'resources\runtime'
$need = @('office-skills\office\SKILL.md', 'versions.json')
$missing = @()
foreach ($n in $need) { if (-not (Test-Path (Join-Path $runtime $n))) { $missing += $n } }
if ($missing.Count -eq 0) { W ('ok: runtime complete (' + $install + ')'); exit 0 }
W ('repair: missing ' + ($missing -join ',') + ' · runtime=' + $runtime)

$dshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $env:USERPROFILE '.dsh' }
$sources = @(
  (Join-Path $dshHome 'plugins\dsh-purge\assets\runtime-min'),
  (Join-Path $dshHome 'profiles\desktop\node_modules\dsh-purge\assets\runtime-min')
)
$src = $sources | Where-Object { Test-Path (Join-Path $_ 'office-skills\office\SKILL.md') } | Select-Object -First 1
if (-not $src) { W ('fail: runtime-min source not found (dshHome=' + $dshHome + ')'); exit 1 }

New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$copied = 0
foreach ($d in @('bin', 'cli', 'office-skills', 'versions.json')) {
  $from = Join-Path $src $d
  if (-not (Test-Path $from)) { continue }
  $to = Join-Path $runtime $d
  $copied += (Copy-Missing $from $to)
}
W ('runtime-min copied files=' + $copied)

$primary = Join-Path $runtime 'primary-runtime\runtime.json'
if (-not (Test-Path $primary)) {
  $backup = Join-Path $dshHome 'dsh-purge\runtime-backup\primary-runtime'
  if (Test-Path $backup) {
    $c2 = Copy-Missing $backup (Join-Path $runtime 'primary-runtime')
    W ('primary-runtime restored files=' + $c2)
  } else {
    W 'warn: primary-runtime backup not found (boot may still work)'
  }
}

$ok = (Test-Path (Join-Path $runtime 'office-skills\office\SKILL.md')) -and (Test-Path (Join-Path $runtime 'versions.json'))
W ('done: ok=' + $ok)
