# Phase 3 Validation Script
# This script checks the current state and readiness for Phase 3 migration

Write-Host "🔍 Phase 3 Validation Check" -ForegroundColor Cyan
Write-Host "===========================" -ForegroundColor Cyan

$rootDir = Get-Location
$hasIssues = $false

# Function to check if directory exists
function Test-DirectoryExists {
    param([string]$Path, [string]$Description)
    if (Test-Path $Path) {
        Write-Host "✅ $Description exists" -ForegroundColor Green
        return $true
    } else {
        Write-Host "❌ $Description missing" -ForegroundColor Red
        return $false
    }
}

# Function to check if package has source files
function Test-PackageHasSource {
    param([string]$PackagePath, [string]$PackageName)
    $srcPath = Join-Path $PackagePath "src"
    if (Test-Path $srcPath) {
        $files = Get-ChildItem -Path $srcPath -Filter "*.ts" -Recurse -File
        if ($files.Count -gt 1) {  # More than just index.ts
            Write-Host "[OK] $PackageName has source files ($($files.Count) files)" -ForegroundColor Green
            return $true
        } else {
            Write-Host "⚠️  $PackageName has minimal source files" -ForegroundColor Yellow
            return $false
        }
    } else {
        Write-Host "❌ $PackageName missing src directory" -ForegroundColor Red
        return $false
    }
}

Write-Host "`n📦 Checking consolidated packages..." -ForegroundColor Yellow
$consolidatedPackages = @(
    @{Name="@noderr/types"; Path="packages/types"},
    @{Name="@noderr/utils"; Path="packages/utils"},
    @{Name="@noderr/execution"; Path="packages/execution"},
    @{Name="@noderr/telemetry"; Path="packages/telemetry"},
    @{Name="@noderr/ml"; Path="packages/ml"}
)

foreach ($pkg in $consolidatedPackages) {
    $exists = Test-DirectoryExists -Path $pkg.Path -Description $pkg.Name
    if ($exists) {
        Test-PackageHasSource -PackagePath $pkg.Path -PackageName $pkg.Name | Out-Null
    }
}

Write-Host "`n📦 Checking old packages to be migrated..." -ForegroundColor Yellow
$oldPackages = @(
    @{Name="execution-engine"; Path="packages/execution-engine"},
    @{Name="execution-enhanced"; Path="packages/execution-enhanced"},
    @{Name="execution-optimizer"; Path="packages/execution-optimizer"},
    @{Name="telemetry-layer"; Path="packages/telemetry-layer"},
    @{Name="telemetry-enhanced"; Path="packages/telemetry-enhanced"},
    @{Name="ai-core"; Path="packages/ai-core"},
    @{Name="ml-enhanced"; Path="packages/ml-enhanced"},
    @{Name="ml-enhancement"; Path="packages/ml-enhancement"},
    @{Name="model-expansion"; Path="packages/model-expansion"}
)

$oldPackagesExist = 0
foreach ($pkg in $oldPackages) {
    if (Test-Path $pkg.Path) {
        Write-Host "📁 $($pkg.Name) exists (needs migration)" -ForegroundColor Yellow
        $oldPackagesExist++
    } else {
        Write-Host "✅ $($pkg.Name) already archived/removed" -ForegroundColor Green
    }
}

Write-Host "`n📦 Checking institutional-grade packages..." -ForegroundColor Yellow
$institutionalPackages = @(
    @{Name="risk-engine"; Path="packages/risk-engine"},
    @{Name="market-intel"; Path="packages/market-intel"},
    @{Name="quant-research"; Path="packages/quant-research"}
)

foreach ($pkg in $institutionalPackages) {
    Test-DirectoryExists -Path $pkg.Path -Description "$($pkg.Name) (institutional)" | Out-Null
}

Write-Host "`n📁 Checking archive structure..." -ForegroundColor Yellow
$archiveExists = Test-DirectoryExists -Path "archive" -Description "Archive directory"
$packagesArchiveExists = Test-DirectoryExists -Path "archive/packages" -Description "Archive/packages directory"

Write-Host "`n🔧 Checking configuration files..." -ForegroundColor Yellow
$configFiles = @(
    @{Path="pnpm-workspace.yaml"; Description="pnpm workspace config"},
    @{Path="package.json"; Description="Root package.json"},
    @{Path="tsconfig.json"; Description="Root tsconfig.json"}
)

foreach ($config in $configFiles) {
    Test-DirectoryExists -Path $config.Path -Description $config.Description | Out-Null
}

Write-Host "`n📊 Summary" -ForegroundColor Cyan
Write-Host "==========" -ForegroundColor Cyan

if ($oldPackagesExist -gt 0) {
    Write-Host "⚠️  $oldPackagesExist old packages need migration" -ForegroundColor Yellow
    $hasIssues = $true
} else {
    Write-Host "✅ All old packages have been archived/removed" -ForegroundColor Green
}

# Check for old package imports
Write-Host "`n🔍 Checking for old package imports..." -ForegroundColor Yellow
$oldImports = @(
    "@noderr/execution-engine",
    "@noderr/execution-enhanced",
    "@noderr/telemetry-layer",
    "@noderr/ai-core"
)

$importCount = 0
foreach ($import in $oldImports) {
    $files = Get-ChildItem -Path . -Include "*.ts","*.tsx" -Recurse -File | 
             Select-String -Pattern $import -SimpleMatch |
             Where-Object { $_.Path -notlike "*node_modules*" -and $_.Path -notlike "*archive*" }
    
    if ($files) {
        Write-Host "⚠️  Found $($files.Count) files with import '$import'" -ForegroundColor Yellow
        $importCount += $files.Count
    }
}

if ($importCount -eq 0) {
    Write-Host "✅ No old package imports found" -ForegroundColor Green
} else {
    Write-Host "⚠️  Total: $importCount files need import updates" -ForegroundColor Yellow
    $hasIssues = $true
}

Write-Host "`n📋 Phase 3 Readiness" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan

if ($hasIssues) {
    Write-Host "⚠️  Phase 3 migration is needed" -ForegroundColor Yellow
    Write-Host "`nRecommended actions:" -ForegroundColor Yellow
    Write-Host "1. Run ./scripts/phase3-migration.ps1" -ForegroundColor Gray
    Write-Host "2. Update import paths manually" -ForegroundColor Gray
    Write-Host "3. Rebuild and test all packages" -ForegroundColor Gray
} else {
    Write-Host "✅ Phase 3 appears to be complete!" -ForegroundColor Green
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "1. Implement institutional-grade features" -ForegroundColor Gray
    Write-Host "2. Follow the INSTITUTIONAL_UPGRADE_PLAN.md" -ForegroundColor Gray
}

Write-Host "`n✨ Validation complete" -ForegroundColor Green 