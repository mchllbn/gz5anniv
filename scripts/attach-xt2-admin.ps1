# Attach Fujifilm X-T2 USB to WSL for gPhoto2 (photobooth shutter + RAW/JPEG).
# Run this script as Administrator.

$ErrorActionPreference = 'Stop'
$usbipd = "${env:ProgramFiles}\usbipd-win\usbipd.exe"
if (-not (Test-Path $usbipd)) {
  Write-Host "Installing usbipd-win..." -ForegroundColor Yellow
  winget install --id dorssel.usbipd-win -e --accept-source-agreements --accept-package-agreements
}

$list = & $usbipd list
Write-Host $list

$busid = $null
foreach ($line in ($list -split "`n")) {
  if ($line -match 'X-T2|04cb:02cd|Fujifilm') {
    $busid = ($line.Trim() -split '\s+')[0]
    if ($busid -match '^\d+-\d+$') { break }
  }
}

if (-not $busid) {
  Write-Host "X-T2 not found. Set PC CONNECTION MODE to USB TETHER SHOOTING AUTO and reconnect USB." -ForegroundColor Red
  exit 1
}

Write-Host "Found X-T2 at BUSID $busid" -ForegroundColor Green
& $usbipd bind --busid $busid
& $usbipd attach --wsl --busid $busid

Write-Host "`nTesting gPhoto2 in WSL..." -ForegroundColor Cyan
wsl gphoto2 --auto-detect
Write-Host "`nIf the camera appears above, restart the photobooth (npm start)." -ForegroundColor Green
Write-Host "Settings -> Fujifilm USB tether only (X-T2). Explorer may no longer show the camera - expected." -ForegroundColor Green
