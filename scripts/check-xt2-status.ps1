# Non-admin status check: why Explorer shows X-T2 but WSL gphoto2 does not.
$usbipd = "${env:ProgramFiles}\usbipd-win\usbipd.exe"

Write-Host "=== Fujifilm X-T2 / photobooth USB status ===" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $usbipd)) {
  Write-Host "usbipd-win missing. Install: winget install dorssel.usbipd-win" -ForegroundColor Red
  exit 1
}

$list = & $usbipd list
Write-Host $list
Write-Host ""

$busid = $null
$state = $null
foreach ($line in ($list -split "`n")) {
  if ($line -match 'X-T2|04cb:02cd') {
    $parts = ($line.Trim() -split '\s+', 4)
    $busid = $parts[0]
    $state = if ($parts.Length -ge 4) { $parts[-1] } else { 'unknown' }
    break
  }
}

if (-not $busid) {
  Write-Host "X-T2 not on USB. Cable + camera power + USB TETHER SHOOTING AUTO." -ForegroundColor Red
  exit 1
}

Write-Host "Windows USB: X-T2 at BUSID $busid (state: $state)" -ForegroundColor Green
Write-Host ""
Write-Host "Why File Explorer shows X-T2 but 'wsl gphoto2 --auto-detect' is empty:" -ForegroundColor Yellow
Write-Host "  - Explorer uses the Windows driver (normal)."
Write-Host "  - gPhoto2 runs inside WSL and needs the camera USB passed through usbipd."
Write-Host "  - Until you attach, WSL will always show an empty list."
Write-Host ""

if ($state -match 'Attached') {
  Write-Host "USB is attached to WSL. Testing gphoto2..." -ForegroundColor Cyan
  wsl gphoto2 --auto-detect
  exit 0
}

Write-Host "NEXT STEP (required once per PC boot):" -ForegroundColor Yellow
Write-Host "  1. Close FUJIFILM X Acquire / Tether and close File Explorer on the X-T2 device."
Write-Host "  2. Camera menu: SET UP -> CONNECTION SETTING -> PC CONNECTION MODE -> USB TETHER SHOOTING AUTO"
Write-Host "  3. Open PowerShell as Administrator and run:"
Write-Host "       cd C:\docker-projects\gz5anniv"
Write-Host "       .\scripts\attach-xt2-admin.ps1"
Write-Host ""
Write-Host "After attach, Explorer may no longer show the X-T2 - that is OK. WSL gphoto2 should list the camera."
