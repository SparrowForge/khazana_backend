/**
 * Pre-start guard for Windows + Prisma.
 *
 * `nest start` has `deleteOutDir: true`, so it wipes `dist/` on every launch.
 * If a previous backend instance is still running, it holds an open handle on
 * `dist/generated/prisma/query_engine-windows.dll.node`, and Windows refuses the
 * unlink with `EPERM: operation not permitted`. This script kills any leftover
 * backend process (this project's `dist/main` or `nest start`) before the build
 * runs, so the DLL is unlocked. It deliberately ignores the frontend and any
 * unrelated node processes.
 *
 * No-op on non-Windows platforms (the EPERM lock is Windows-specific).
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

if (process.platform !== 'win32') {
  process.exit(0);
}

const backendDir = path.resolve(__dirname, '..');
const self = process.pid;

// PowerShell script. Quoting is safe here because we pass it via -EncodedCommand
// (base64 UTF-16LE), which avoids all shell-nesting/quote-collapse issues.
const script = `
$self = ${self}
$needle = '${backendDir.replace(/'/g, "''")}'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object {
    $_.ProcessId -ne $self -and $_.CommandLine -and
    $_.CommandLine.ToLower().Contains($needle.ToLower()) -and
    ($_.CommandLine -like '*dist\\main*' -or $_.CommandLine -like '*nest*start*')
  } |
  ForEach-Object {
    Write-Output "free-lock: stopping stale backend PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force
  }
`;

const encoded = Buffer.from(script, 'utf16le').toString('base64');

try {
  const out = execFileSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8' },
  );
  if (out.trim()) process.stdout.write(out);
} catch {
  // A failed kill (e.g. process already gone) must never block startup.
}
