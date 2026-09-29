# Stop only the API process previously started by start.ps1 for this project.
$ErrorActionPreference = "Stop"
$state = Join-Path $PSScriptRoot "..\tmp\server.json"
if (-not (Test-Path $state)) {
  Write-Host "No recorded server (tmp/server.json missing). Nothing to stop."
  exit 0
}
$info = Get-Content $state | ConvertFrom-Json
if ($info.pid -and (Get-Process -Id $info.pid -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $info.pid -Force
  Write-Host "Stopped OCR API pid=$($info.pid) port=$($info.port)"
} else {
  Write-Host "Process pid=$($info.pid) not running."
}
Remove-Item $state -Force -ErrorAction SilentlyContinue
