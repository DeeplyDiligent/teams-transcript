# Build and Run Teams Transcript Viewer (Production Mode)

Write-Host "Building Teams Transcript Viewer (PRODUCTION MODE)..." -ForegroundColor Green
Write-Host ""

# Build the frontend
Write-Host "Building React frontend..." -ForegroundColor Yellow
Push-Location frontend
$buildResult = & pnpm run build 2>&1
Pop-Location

if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed!" -ForegroundColor Red
    Write-Host $buildResult
    exit 1
}

Write-Host "Frontend built successfully!" -ForegroundColor Green
Write-Host ""

# Check if dist folder was created
if (-not (Test-Path "frontend\dist\index.html")) {
    Write-Host "Error: Build succeeded but frontend\dist\index.html not found!" -ForegroundColor Red
    exit 1
}

Write-Host "Starting production server..." -ForegroundColor Yellow
Write-Host ""

# Start main.py (serves both API and static frontend)
$mainProcess = Start-Process -FilePath ".\venv\Scripts\python.exe" -ArgumentList "main.py" -PassThru

Write-Host "Production server is running!" -ForegroundColor Green
Write-Host "- Application: http://localhost:5000" -ForegroundColor Cyan
Write-Host "- API: http://localhost:5000/api" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to stop the server..." -ForegroundColor Red
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Stop the process
Write-Host ""
Write-Host "Stopping server..." -ForegroundColor Yellow
Stop-Process -Id $mainProcess.Id -Force -ErrorAction SilentlyContinue

# Also kill any child processes
Get-Process | Where-Object { $_.ProcessName -eq "python" } | ForEach-Object {
    try {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    } catch {}
}

Write-Host "Server stopped." -ForegroundColor Green
