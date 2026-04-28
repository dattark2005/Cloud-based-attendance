# ============================================================
#  Cloud-Based Attendance System — Master Startup Script
#  Usage: .\start.ps1
#  Starts: Backend (Node + Face + Voice) + Frontend (Next.js)
# ============================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Cloud-Based Attendance System" -ForegroundColor Cyan
Write-Host "  Starting all services..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$root = $PSScriptRoot

# ── Launch Backend (Node + Face + Voice via concurrently) ──
Write-Host "[1/2] Starting Backend + Face + Voice services..." -ForegroundColor Yellow
$backend = Start-Process powershell -ArgumentList `
    "-NoExit", "-Command", `
    "cd '$root\backend'; `$host.UI.RawUI.WindowTitle = 'Backend | Face | Voice'; npm run dev" `
    -PassThru

# ── Launch Frontend (Next.js) ──
Write-Host "[2/2] Starting Frontend (Next.js)..." -ForegroundColor Green
$frontend = Start-Process powershell -ArgumentList `
    "-NoExit", "-Command", `
    "cd '$root\frontend'; `$host.UI.RawUI.WindowTitle = 'Frontend — Next.js :3000'; npm run dev" `
    -PassThru

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  All services launched!" -ForegroundColor Green
Write-Host ""
Write-Host "  Frontend  →  http://localhost:3000" -ForegroundColor White
Write-Host "  Backend   →  http://localhost:3001" -ForegroundColor White
Write-Host "  Face API  →  http://localhost:8000" -ForegroundColor White
Write-Host "  Voice API →  http://localhost:8081" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C here or close the windows to stop." -ForegroundColor Gray
