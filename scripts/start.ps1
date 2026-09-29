# Start the OCR layout API bound to 127.0.0.1 with an auto-selected port.
# Writes the chosen port and the node PID to tmp/server.json so stop.ps1 can
# manage only this project's process.
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path "tmp" | Out-Null
$dbPath = if ($env:OCR_DB_PATH) { $env:OCR_DB_PATH } else { "data/app.db" }
$proc = Start-Process -FilePath "node" `
  -ArgumentList "node_modules/tsx/dist/cli.mjs src/api/server.ts" `
  -WorkingDirectory $PSScriptRoot/.. `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput "tmp/server.out.log" -RedirectStandardError "tmp/server.err.log"
# Port 0 auto-select; read it back from the startup log.
$port = $null
for ($i = 0; $i -lt 50 -and -not $port; $i++) {
  Start-Sleep -Milliseconds 100
  if (Test-Path "tmp/server.err.log") {
    $m = Select-String -Path "tmp/server.err.log","tmp/server.out.log" -Pattern "listening on http://127.0.0.1:(\d+)" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($m) { $port = $m.Matches[0].Groups[1].Value }
  }
}
$info = [pscustomobject]@{ pid = $proc.Id; port = [int]$port; db = $dbPath }
$info | ConvertTo-Json | Set-Content "tmp/server.json"
Write-Host "Started OCR API pid=$($proc.Id) port=$port (http://127.0.0.1:$port)"
