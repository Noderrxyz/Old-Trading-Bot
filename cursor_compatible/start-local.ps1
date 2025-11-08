#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Starts the Noderr Protocol in local test mode
.DESCRIPTION
    This script sets up and runs the Noderr Protocol trading system in a local testing environment
#>

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "            NODERR PROTOCOL - LOCAL TEST MODE" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Starting Noderr Protocol in local testing mode..." -ForegroundColor Green
Write-Host ""

# Check if node_modules exists
if (!(Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install
    Write-Host ""
}

# Check if TypeScript is installed globally
$tsNodePath = Get-Command ts-node -ErrorAction SilentlyContinue
if (!$tsNodePath) {
    Write-Host "Installing TypeScript and ts-node..." -ForegroundColor Yellow
    npm install -g typescript ts-node
    Write-Host ""
}

# Set environment variables for local testing
$env:NODE_ENV = "development"
$env:ENABLE_LIVE_TRADING = "false"
$env:LOG_LEVEL = "debug"

Write-Host "Environment configured:" -ForegroundColor Cyan
Write-Host "  NODE_ENV: $env:NODE_ENV"
Write-Host "  ENABLE_LIVE_TRADING: $env:ENABLE_LIVE_TRADING"
Write-Host "  LOG_LEVEL: $env:LOG_LEVEL"
Write-Host ""

# Run the local test
Write-Host "Launching system..." -ForegroundColor Green
Write-Host ""

npx ts-node test-local.ts

# Keep window open if script fails
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Press any key to exit..." -ForegroundColor Red
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
} 