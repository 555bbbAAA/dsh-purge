// Placeholders are filled by official-update.js / core.js. Quit the official client, run the downloaded installer, then reopen.
// Keep this file ASCII only: #46 throws when any charCodeAt > 127.
var exe = __EXE_JSON__;
var installer = __INSTALLER_JSON__;
var resources = __RESOURCES_JSON__;
var installDir = __INSTALL_DIR_JSON__;
if (installDir.length > 3) installDir = installDir.replace(/[\\\/]+$/, '');
var logPath = __LOG_JSON__;
var fso = new ActiveXObject('Scripting.FileSystemObject');
var sh = new ActiveXObject('WScript.Shell');
var wmi = GetObject('winmgmts:\\\\.\\root\\cimv2');
function z(n) { return (n < 10 ? '0' : '') + n; }
function stamp() { var d = new Date(); return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + 'T' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds()); }
function log(m) { var f = fso.OpenTextFile(logPath, 8, true); f.WriteLine(stamp() + ' ' + m); f.Close(); }
function samePath(a, b) { return String(a || '').replace(/\//g, '\\').toLowerCase() === String(b || '').replace(/\//g, '\\').toLowerCase(); }
function pids() { var out = []; var e = new Enumerator(wmi.ExecQuery("SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = 'DeepSeek Harness.exe'")); for (; !e.atEnd(); e.moveNext()) { var p = e.item(); if (samePath(p.ExecutablePath, exe)) out.push(p.ProcessId); } return out; }
function fileSize(fp) { if (!fso.FileExists(fp)) return -1; return fso.GetFile(fp).Size; }
function fileStamp(fp) { if (!fso.FileExists(fp)) return ''; return String(fso.GetFile(fp).DateLastModified); }
// Count uninstall registry entries that mention Harness. A missing / stale entry is one of the
// reasons electron-builder NSIS refuses to install and returns 2 without writing a single file.
function regCount(root) {
  try {
    var e = sh.Exec('reg query "' + root + '" /s /f "Harness" /d');
    var out = e.StdOut.ReadAll();
    if (!out) return 0;
    var lines = out.split('\r\n');
    var n = 0;
    for (var k = 0; k < lines.length; k++) { if (lines[k].indexOf('Harness') >= 0) n++; }
    return n;
  } catch (err) {
    return -1;
  }
}
// Wait until the file size stops moving, so we never start the app against a half written archive.
function settle(fp, budgetMs) {
  var end = new Date().getTime() + budgetMs;
  var last = fileSize(fp);
  while (new Date().getTime() < end) {
    WScript.Sleep(300);
    var now = fileSize(fp);
    if (now === last && now !== -1) return now;
    last = now;
  }
  log('settle-timeout size=' + last);
  return last;
}

log('update-begin exe=' + exe);
log('installer=' + installer);
WScript.Sleep(800);
var list = pids();
log('pids ' + list.join(','));
for (var i = 0; i < list.length; i++) sh.Run('taskkill.exe /F /PID ' + list[i], 0, true);
var deadline = new Date().getTime() + 20000;
var left = list;
while (new Date().getTime() < deadline) { left = pids(); if (left.length === 0) break; WScript.Sleep(200); }
log('left ' + left.length);

var asar = resources + '\\app.asar';
var bak = asar + '.bak';
var appDir = resources + '\\app';
var movedApp = false;
var prev = '';
if (fso.FolderExists(appDir)) {
  prev = appDir + '.dshpurge-prev';
  if (fso.FolderExists(prev)) prev = appDir + '.dshpurge-prev-' + (new Date().getTime());
  for (var n = 0; n < 40; n++) {
    try { fso.MoveFolder(appDir, prev); movedApp = true; log('moved-app'); break; }
    catch (moveErr) { log('move-app ' + (moveErr && moveErr.message ? moveErr.message : moveErr)); WScript.Sleep(250); }
  }
}
var copiedAsar = false;
if (!fso.FileExists(asar) && fso.FileExists(bak)) {
  try { fso.CopyFile(bak, asar, true); copiedAsar = true; log('restored-asar size=' + fileSize(asar)); }
  catch (restoreErr) { log('restore-asar ' + (restoreErr && restoreErr.message ? restoreErr.message : restoreErr)); }
}
var exeBeforeSize = fileSize(exe);
var exeBeforeStamp = fileStamp(exe);
var asarBeforeSize = fileSize(asar);

function runInstaller(updated) {
  var args = updated ? ' --updated /S /D=' : ' /S /D=';
  return sh.Run('"' + installer + '"' + args + installDir, 0, true);
}
// Some installs live under a path that needs elevation; a silent run then returns 5 / 740 / 1223
// and nothing changes on disk. Retry through RunAs so the user sees one UAC prompt instead of a dead update.
function runInstallerElevated() {
  var args = '--updated /S /D=' + installDir;
  var ps = 'powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath \'' + installer + '\' -ArgumentList \'' + args + '\' -Verb RunAs -Wait"';
  return sh.Run(ps, 0, true);
}
function changed() {
  return {
    exe: fileSize(exe) !== exeBeforeSize || fileStamp(exe) !== exeBeforeStamp,
    asar: fileSize(asar) !== asarBeforeSize
  };
}

var code = runInstaller(true);
log('installer ' + code);
var c = changed();
log('changed exe=' + c.exe + ' asar=' + c.asar + ' asarSize=' + fileSize(asar));
if (!c.exe && !c.asar && code !== 0) {
  code = runInstaller(false);
  log('installer-plain ' + code);
  c = changed();
  log('changed-plain exe=' + c.exe + ' asar=' + c.asar + ' asarSize=' + fileSize(asar));
}
if (!c.exe && !c.asar && (code === 5 || code === 740 || code === 1223)) {
  log('installer-retry-elevated');
  code = runInstallerElevated();
  log('installer-elevated ' + code);
  c = changed();
  log('changed-elevated exe=' + c.exe + ' asar=' + c.asar + ' asarSize=' + fileSize(asar));
}

var asarPresent = fso.FileExists(asar);
var asarFinal = asarPresent ? settle(asar, 5000) : -1;
// Success rule: the archive is there and either the installer said 0 or something on disk changed.
// The old rule required a size/mtime change, so a same version rebuild (identical bytes, preserved
// timestamps) was judged a failure: it deleted the freshly installed archive and reopened the old
// unpacked directory. That is exactly the "update never applies, old page comes back" symptom.
var ok = asarPresent && (code === 0 || c.exe || c.asar);
log('verdict ok=' + ok + ' asarPresent=' + asarPresent + ' asarSize=' + asarFinal + ' code=' + code);

if (!ok) {
  // Never delete a freshly written archive: it may already be the new build and deleting it
  // is what makes an update unrecoverable. Only put the patched directory back when no archive exists.
  if (copiedAsar && !asarPresent) {
    try { fso.DeleteFile(asar, true); log('rehid-asar'); } catch (hideErr) { log('rehid-asar ' + hideErr); }
  }
  if (asarPresent) log('kept-asar size=' + asarFinal);
  if (movedApp && prev && fso.FolderExists(prev)) {
    if (fso.FolderExists(appDir)) {
      try { fso.DeleteFolder(appDir, true); log('cleared-recreated-app'); } catch (clearErr) { log('cleared-recreated-app ' + clearErr); }
    }
    if (!fso.FolderExists(appDir)) {
      try { fso.MoveFolder(prev, appDir); log('restored-app'); } catch (backErr) { log('restored-app ' + backErr); }
    }
  }
  try { sh.Environment('PROCESS').Remove('ELECTRON_RUN_AS_NODE'); } catch (ignore) {}
  sh.Run('"' + exe + '"', 1, false);
  log('started-old');
  // Silent failures look like "it restarted but nothing changed". Record why, then say it out loud.
  log('diag uninstall hkcu=' + regCount('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
    + ' hklm=' + regCount('HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
    + ' wow=' + regCount('HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'));
  log('diag procs=' + pids().length + ' asar=' + asarPresent + ' appDir=' + fso.FolderExists(appDir) + ' exe=' + fso.FileExists(exe));
  var reason = code === 2 ? "\u5b89\u88c5\u5668\u5728\u5199\u6587\u4ef6\u4e4b\u524d\u5c31\u9000\u51fa\u4e86\uff08\u5e38\u89c1\uff1a\u5b83\u8ba4\u4e3a\u5e94\u7528\u4ecd\u5728\u8fd0\u884c\uff0c\u6216\u5df2\u6709\u5b89\u88c5\u8bb0\u5f55\u4e0e\u76ee\u6807\u8def\u5f84\u5bf9\u4e0d\u4e0a\uff09" : ((code === 5 || code === 740 || code === 1223) ? "\u5b89\u88c5\u9700\u8981\u66f4\u9ad8\u6743\u9650\uff0c\u63d0\u6743\u91cd\u8bd5\u4e5f\u6ca1\u8fc7" : "\u5b89\u88c5\u5668\u6ca1\u6709\u5199\u51fa\u4efb\u4f55\u6587\u4ef6");
  sh.Popup("dsh \u5347\u7ea7\u6ca1\u88c5\u4e0a\u3002\\r\\n\\r\\n\u5b89\u88c5\u5668\u9000\u51fa\u7801 " + code + "\\r\\n" + reason + "\\r\\n\\r\\n\u73b0\u5728\u6253\u5f00\u7684\u8fd8\u662f\u65e7\u7248\u672c\u3002\u8bca\u65ad\u65e5\u5fd7\uff1a" + logPath, 90, "dsh-purge: \u5347\u7ea7\u672a\u5b8c\u6210", 48);
  log('popup-shown');
} else {
  if (!movedApp && fso.FolderExists(appDir)) log('move-app-failed');
  try {
    var marker = fso.CreateTextFile(resources + '\\dsh-purge-reapply-asar', true);
    marker.WriteLine('1');
    marker.Close();
    log('marker');
  } catch (markerErr) { log('marker ' + markerErr); }
  try { sh.Environment('PROCESS').Remove('ELECTRON_RUN_AS_NODE'); } catch (ignore2) {}
  sh.Run('"' + exe + '"', 1, false);
  log('started');
}
