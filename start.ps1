# Start Teams Transcript Viewer (Development Mode)

Write-Host "Starting Teams Transcript Viewer (DEV MODE)..." -ForegroundColor Green
Write-Host ""

# Load environment variables from .env file if it exists
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

# Start main.py (API + Caption Capture) in a new window
Write-Host "Starting API + Caption Capture on port 5000..." -ForegroundColor Yellow
$mainProcess = Start-Process cmd -ArgumentList "/k", ".\venv\Scripts\python.exe main.py --debug" -PassThru

# Wait a moment for Flask to start
Start-Sleep -Seconds 2

# Start Vite dev server in a new window
Write-Host "Starting Vite dev server on port 5173..." -ForegroundColor Yellow
$viteProcess = Start-Process cmd -ArgumentList "/k", "cd frontend && pnpm run dev" -PassThru

Write-Host ""
Write-Host "All servers are running..." -ForegroundColor Green
Write-Host "- API: http://localhost:5000/api" -ForegroundColor Cyan
Write-Host "- Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to stop all servers..." -ForegroundColor Red
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

# Stop all processes
Write-Host ""
Write-Host "Stopping all servers..." -ForegroundColor Yellow
Stop-Process -Id $mainProcess.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $viteProcess.Id -Force -ErrorAction SilentlyContinue

# Also kill any child processes
Get-Process | Where-Object { $_.ProcessName -eq "python" -or $_.ProcessName -eq "node" } | ForEach-Object {
    try {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    } catch {}
}

Write-Host "All servers stopped." -ForegroundColor Green
