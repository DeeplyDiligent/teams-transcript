# Build Teams Transcript Viewer Frontend

Write-Host "Building Teams Transcript Viewer..." -ForegroundColor Green
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

Write-Host "Build complete! Run .\run-built-app.ps1 to start the production server." -ForegroundColor Cyan
