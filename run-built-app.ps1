
# Check if dist folder was created
if (-not (Test-Path "frontend\dist\index.html")) {
    Write-Host "Error: Build succeeded but frontend\dist\index.html not found!" -ForegroundColor Red
    exit 1
}

if (Test-Path ".env") {
    Write-Host "Loading configuration from .env file..." -ForegroundColor Yellow
    Get-Content ".env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
            
            # Show backend configuration
            if ($key -eq "AI_BACKEND") {
                Write-Host "  AI Backend: $value" -ForegroundColor Cyan
            }
        }
    }
    Write-Host ""
}


Write-Host "Starting production server..." -ForegroundColor Yellow
Write-Host ""
Write-Host "Production server running!" -ForegroundColor Green
Write-Host "- Application: http://localhost:5000" -ForegroundColor Cyan
Write-Host "- API: http://localhost:5000/api" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press Ctrl+C to stop the server..." -ForegroundColor Red
Write-Host ""

# Start main.py (serves both API and static frontend) in current process
.\venv\Scripts\python.exe main.py
