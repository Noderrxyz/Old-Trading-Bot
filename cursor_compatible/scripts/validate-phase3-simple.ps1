# Phase 3 Validation Script (Simple Version)
# This script checks the current state and readiness for Phase 3 migration

Write-Host "Phase 3 Validation Check" -ForegroundColor Cyan
Write-Host "========================" -ForegroundColor Cyan

$rootDir = Get-Location
$hasIssues = $false

# Function to check if directory exists
function Test-DirectoryExists {
    param([string]$Path, [string]$Description)
    if (Test-Path $Path) {
        Write-Host "[OK] $Description exists" -ForegroundColor Green
        return $true
    } else {
        Write-Host "[MISSING] $Description missing" -ForegroundColor Red
        return $false
    }
}

Write-Host "`nChecking consolidated packages..." -ForegroundColor Yellow
$consolidatedPackages = @(
    @{Name="@noderr/types"; Path="packages/types"},
    @{Name="@noderr/utils"; Path="packages/utils"},
    @{Name="@noderr/execution"; Path="packages/execution"},
    @{Name="@noderr/telemetry"; Path="packages/telemetry"},
    @{Name="@noderr/ml"; Path="packages/ml"}
)

foreach ($pkg in $consolidatedPackages) {
    Test-DirectoryExists -Path $pkg.Path -Description $pkg.Name | Out-Null
}

Write-Host "`nChecking old packages to be migrated..." -ForegroundColor Yellow
$oldPackages = @(
    "packages/execution-engine",
    "packages/execution-enhanced",
    "packages/execution-optimizer",
    "packages/telemetry-layer",
    "packages/telemetry-enhanced",
    "packages/ai-core",
    "packages/ml-enhanced",
    "packages/ml-enhancement",
    "packages/model-expansion"
)

$oldPackagesExist = 0
foreach ($pkg in $oldPackages) {
    if (Test-Path $pkg) {
        Write-Host "[EXISTS] $pkg (needs migration)" -ForegroundColor Yellow
        $oldPackagesExist++
    } else {
        Write-Host "[OK] $pkg already archived/removed" -ForegroundColor Green
    }
}

Write-Host "`nChecking institutional-grade packages..." -ForegroundColor Yellow
$institutionalPackages = @(
    @{Name="risk-engine"; Path="packages/risk-engine"},
    @{Name="market-intel"; Path="packages/market-intel"},
    @{Name="quant-research"; Path="packages/quant-research"}
)

foreach ($pkg in $institutionalPackages) {
    Test-DirectoryExists -Path $pkg.Path -Description "$($pkg.Name) (institutional)" | Out-Null
}

Write-Host "`nSummary" -ForegroundColor Cyan
Write-Host "=======" -ForegroundColor Cyan

if ($oldPackagesExist -gt 0) {
    Write-Host "[WARNING] $oldPackagesExist old packages need migration" -ForegroundColor Yellow
    $hasIssues = $true
} else {
    Write-Host "[OK] All old packages have been archived/removed" -ForegroundColor Green
}

Write-Host "`nPhase 3 Readiness" -ForegroundColor Cyan
Write-Host "=================" -ForegroundColor Cyan

if ($hasIssues) {
    Write-Host "[ACTION NEEDED] Phase 3 migration is required" -ForegroundColor Yellow
    Write-Host "`nRecommended actions:" -ForegroundColor Yellow
    Write-Host "1. Run ./scripts/phase3-migration.ps1" -ForegroundColor Gray
    Write-Host "2. Update import paths manually" -ForegroundColor Gray
    Write-Host "3. Rebuild and test all packages" -ForegroundColor Gray
} else {
    Write-Host "[READY] Phase 3 appears to be complete!" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "1. Implement institutional-grade features" -ForegroundColor Gray
    Write-Host "2. Follow the INSTITUTIONAL_UPGRADE_PLAN.md" -ForegroundColor Gray
}

Write-Host "`nValidation complete" -ForegroundColor Green 