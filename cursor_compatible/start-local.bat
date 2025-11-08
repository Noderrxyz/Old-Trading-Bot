@echo off
echo.
echo ============================================================
echo             NODERR PROTOCOL - LOCAL TEST MODE
echo ============================================================
echo.
echo Starting Noderr Protocol in local testing mode...
echo.

REM Check if node_modules exists
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

REM Check if TypeScript is installed
where /q ts-node
if errorlevel 1 (
    echo Installing TypeScript and ts-node...
    npm install -g typescript ts-node
    echo.
)

REM Run the local test
echo Launching system...
echo.
npx ts-node test-local.ts

pause 