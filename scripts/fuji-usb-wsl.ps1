# Attach Fujifilm USB camera to WSL so gphoto2 can control the X-T2.
# Run PowerShell as Administrator for bind/attach.

Write-Host "=== Fuji X-T2 + gPhoto2 (WSL USB) ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Camera: SET UP -> CONNECTION SETTING -> PC CONNECTION MODE -> USB TETHER SHOOTING AUTO"
Write-Host "Close FUJIFILM X Acquire / Tether App on Windows before attaching USB to WSL."
Write-Host ""

if (-not (Get-Command usbipd -ErrorAction SilentlyContinue)) {
  $usbipdExe = "${env:ProgramFiles}\usbipd-win\usbipd.exe"
  if (Test-Path $usbipdExe) {
    function usbipd { & $usbipdExe @args }
  }
}

if (-not (Get-Command usbipd -ErrorAction SilentlyContinue)) {
  Write-Host "Installing usbipd-win (Admin may be required)..." -ForegroundColor Yellow
  winget install --id dorssel.usbipd-win -e --accept-source-agreements --accept-package-agreements
  $usbipdExe = "${env:ProgramFiles}\usbipd-win\usbipd.exe"
  if (Test-Path $usbipdExe) { function usbipd { & $usbipdExe @args } }
}

if (-not (Get-Command usbipd -ErrorAction SilentlyContinue)) {
  Write-Host "usbipd not found. Install from: https://github.com/dorssel/usbipd-win/releases" -ForegroundColor Red
  exit 1
}

Write-Host "USB devices (look for Fujifilm / Fuji / PTP):" -ForegroundColor Green
usbipd list

Write-Host ""
Write-Host "If 'usbipd' is not recognized, use the full path:" -ForegroundColor Yellow
Write-Host '  & "C:\Program Files\usbipd-win\usbipd.exe" list'

Write-Host ""
Write-Host "Next (replace BUSID, e.g. 2-3):" -ForegroundColor Yellow
Write-Host "  usbipd bind --busid BUSID"
Write-Host "  usbipd attach --wsl --busid BUSID"
Write-Host ""
Write-Host "Then test:" -ForegroundColor Yellow
Write-Host "  wsl gphoto2 --auto-detect"
Write-Host "  wsl gphoto2 --capture-image-and-download --filename /tmp/test.jpg"
Write-Host ""
