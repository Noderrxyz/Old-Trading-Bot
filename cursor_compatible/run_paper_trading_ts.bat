@echo off
echo ================================================
echo     NODERR PAPER TRADING SYSTEM (TYPESCRIPT)
echo ================================================
echo.

:: Create logs directory if it doesn't exist
if not exist logs mkdir logs

:: Check for node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Node.js is not installed or not in PATH.
  echo Please install Node.js from https://nodejs.org/
  goto :exit
)

:: Check for required modules
echo Checking for required modules...
if not exist node_modules\.bin\ts-node.cmd (
  echo Installing required modules...
  call npm install
)

:: Try to run the paper trading system with typescript directly
echo Starting paper trading system...
echo.
echo Using flag --transpile-only to skip type checking
echo This will allow the system to run even if there are TypeScript errors
echo.

node_modules\.bin\ts-node.cmd --transpile-only src/examples/run_24_7_paper_trading.ts

:exit
echo.
echo Press any key to exit...
pause > nul 