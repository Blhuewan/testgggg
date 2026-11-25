@echo off
cd /d "%~dp0"
echo Starting Nexa Auto Hub local server...
if not exist node_modules (
  echo Installing required packages for the first run...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if not exist .dev.vars (
  echo.
  echo IMPORTANT: Create a .dev.vars file using .dev.vars.example
  echo Add your Paystack TEST secret key and a private admin PIN.
  echo Also configure your D1 database ID in wrangler.jsonc.
  echo.
  pause
)
call npm run dev
pause
