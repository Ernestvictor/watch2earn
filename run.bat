@echo off
REM Watch2Earn Setup and Run Script

echo.
echo ================================
echo  Watch2Earn Server Setup
echo ================================
echo.

REM Step 1: Navigate to project directory
cd /d "%~dp0"
echo Current directory: %cd%
echo.

REM Step 2: Check if node_modules exists
if exist node_modules (
    echo ✓ node_modules already exists
) else (
    echo Installing dependencies...
    call npm install
    if %errorLevel% neq 0 (
        echo.
        echo ❌ npm install failed. Try:
        echo npm cache clean --force
        echo npm install
        pause
        exit /b 1
    )
)

REM Step 3: Check if firebase-admin works
echo.
echo Testing firebase-admin...
node -e "const admin = require('firebase-admin'); console.log('✓ firebase-admin loaded successfully');" 2>nul
if %errorLevel% neq 0 (
    echo ❌ firebase-admin not properly installed
    echo Reinstalling firebase-admin...
    call npm uninstall firebase-admin
    call npm install firebase-admin@14.2.0
)

REM Step 4: Start the server
echo.
echo ================================
echo Starting Watch2Earn server...
echo ================================
echo.

node server.js

pause
