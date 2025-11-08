# Phase 3 Migration Script for Noderr Trading Bot
# This script automates the migration from old packages to consolidated packages

Write-Host "🚀 Starting Phase 3 Migration Process" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# Set error action preference
$ErrorActionPreference = "Stop"

# Get the root directory
$rootDir = Get-Location

# Function to check if pnpm is installed
function Test-PnpmInstalled {
    try {
        $null = pnpm --version
        return $true
    } catch {
        return $false
    }
}

# Function to create directory if it doesn't exist
function Ensure-Directory {
    param([string]$Path)
    if (!(Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
        Write-Host "✅ Created directory: $Path" -ForegroundColor Green
    }
}

# Function to safely move files
function Move-SafeFiles {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$Pattern = "*"
    )
    
    if (Test-Path $Source) {
        $files = Get-ChildItem -Path $Source -Filter $Pattern -Recurse -File
        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring($Source.Length).TrimStart('\', '/')
            $destPath = Join-Path $Destination $relativePath
            $destDir = Split-Path $destPath -Parent
            
            Ensure-Directory -Path $destDir
            
            if (!(Test-Path $destPath)) {
                Copy-Item -Path $file.FullName -Destination $destPath -Force
                Write-Host "  📄 Migrated: $relativePath" -ForegroundColor Gray
            } else {
                Write-Host "  ⚠️  Skipped (exists): $relativePath" -ForegroundColor Yellow
            }
        }
    } else {
        Write-Host "  ⚠️  Source not found: $Source" -ForegroundColor Yellow
    }
}

# Check prerequisites
Write-Host "`n📋 Checking prerequisites..." -ForegroundColor Yellow
if (!(Test-PnpmInstalled)) {
    Write-Host "❌ pnpm is not installed. Please install it first: npm install -g pnpm" -ForegroundColor Red
    exit 1
}
Write-Host "✅ pnpm is installed" -ForegroundColor Green

# Step 1: Install dependencies
Write-Host "`n📦 Step 1: Installing dependencies..." -ForegroundColor Yellow
try {
    pnpm install
    Write-Host "✅ Dependencies installed successfully" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to install dependencies: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Build packages in order
Write-Host "`n🔨 Step 2: Building packages in dependency order..." -ForegroundColor Yellow
$packages = @(
    "@noderr/types",
    "@noderr/utils",
    "@noderr/telemetry",
    "@noderr/execution",
    "@noderr/ml"
)

foreach ($package in $packages) {
    Write-Host "  Building $package..." -ForegroundColor Cyan
    try {
        pnpm --filter $package build
        Write-Host "  ✅ $package built successfully" -ForegroundColor Green
    } catch {
        Write-Host "  ⚠️  Failed to build $package (may need source files first)" -ForegroundColor Yellow
    }
}

# Step 3: Create archive directory structure
Write-Host "`n📁 Step 3: Creating archive directory structure..." -ForegroundColor Yellow
$archiveDir = Join-Path $rootDir "archive"
$packagesArchiveDir = Join-Path $archiveDir "packages"
Ensure-Directory -Path $packagesArchiveDir

# Step 4: Migrate source files
Write-Host "`n🚚 Step 4: Migrating source files to consolidated packages..." -ForegroundColor Yellow

# Execution package migrations
Write-Host "`n  📦 Migrating execution packages..." -ForegroundColor Cyan
$executionSources = @(
    "packages/execution-engine/src",
    "packages/execution-enhanced/src",
    "packages/execution-optimizer/src"
)
$executionDest = Join-Path $rootDir "packages/execution/src"

foreach ($source in $executionSources) {
    Write-Host "    From: $source" -ForegroundColor Gray
    Move-SafeFiles -Source $source -Destination $executionDest -Pattern "*.ts"
}

# Telemetry package migrations
Write-Host "`n  📦 Migrating telemetry packages..." -ForegroundColor Cyan
$telemetrySources = @(
    "packages/telemetry-layer/src",
    "packages/telemetry-enhanced/src"
)
$telemetryDest = Join-Path $rootDir "packages/telemetry/src"

foreach ($source in $telemetrySources) {
    Write-Host "    From: $source" -ForegroundColor Gray
    Move-SafeFiles -Source $source -Destination $telemetryDest -Pattern "*.ts"
}

# ML package migrations
Write-Host "`n  📦 Migrating ML/AI packages..." -ForegroundColor Cyan
$mlSources = @(
    "packages/ai-core/src",
    "packages/ml-enhanced/src",
    "packages/ml-enhancement/src",
    "packages/model-expansion/src"
)
$mlDest = Join-Path $rootDir "packages/ml/src"

foreach ($source in $mlSources) {
    Write-Host "    From: $source" -ForegroundColor Gray
    Move-SafeFiles -Source $source -Destination $mlDest -Pattern "*.ts"
}

# Step 5: Update import paths
Write-Host "`n🔄 Step 5: Updating import paths..." -ForegroundColor Yellow
Write-Host "  ⚠️  This step requires manual review. Common replacements:" -ForegroundColor Yellow
Write-Host "    - '@noderr/execution-engine' → '@noderr/execution'" -ForegroundColor Gray
Write-Host "    - '@noderr/execution-enhanced' → '@noderr/execution'" -ForegroundColor Gray
Write-Host "    - '@noderr/telemetry-layer' → '@noderr/telemetry'" -ForegroundColor Gray
Write-Host "    - '@noderr/ai-core' → '@noderr/ml'" -ForegroundColor Gray

# Step 6: Archive old packages
Write-Host "`n📦 Step 6: Archiving old packages..." -ForegroundColor Yellow
$packagesToArchive = @(
    "execution-engine",
    "execution-enhanced", 
    "execution-optimizer",
    "telemetry-layer",
    "telemetry-enhanced",
    "ai-core",
    "ml-enhanced",
    "ml-enhancement",
    "model-expansion"
)

foreach ($pkg in $packagesToArchive) {
    $sourcePath = Join-Path $rootDir "packages/$pkg"
    $destPath = Join-Path $packagesArchiveDir $pkg
    
    if (Test-Path $sourcePath) {
        Write-Host "  📁 Archiving $pkg..." -ForegroundColor Gray
        Move-Item -Path $sourcePath -Destination $destPath -Force
        Write-Host "  ✅ Archived $pkg" -ForegroundColor Green
    } else {
        Write-Host "  ⚠️  Package not found: $pkg" -ForegroundColor Yellow
    }
}

# Step 7: Update workspace configuration
Write-Host "`n📝 Step 7: Updating workspace configuration..." -ForegroundColor Yellow
$workspaceFile = Join-Path $rootDir "pnpm-workspace.yaml"
if (Test-Path $workspaceFile) {
    Write-Host "  ⚠️  Please manually update pnpm-workspace.yaml to remove archived packages" -ForegroundColor Yellow
} else {
    Write-Host "  ⚠️  pnpm-workspace.yaml not found" -ForegroundColor Yellow
}

# Step 8: Rebuild all packages
Write-Host "`n🔨 Step 8: Rebuilding all packages with migrated code..." -ForegroundColor Yellow
foreach ($package in $packages) {
    Write-Host "  Building $package..." -ForegroundColor Cyan
    try {
        pnpm --filter $package build
        Write-Host "  ✅ $package built successfully" -ForegroundColor Green
    } catch {
        Write-Host "  [FAILED] Failed to build ${package}: $_" -ForegroundColor Red
    }
}

# Step 9: Run tests
Write-Host "`n🧪 Step 9: Running tests..." -ForegroundColor Yellow
try {
    pnpm test
    Write-Host "✅ All tests passed" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Some tests failed. Please review and fix." -ForegroundColor Yellow
}

# Final summary
Write-Host "`n✨ Phase 3 Migration Summary" -ForegroundColor Green
Write-Host "============================" -ForegroundColor Green
Write-Host "✅ Dependencies installed" -ForegroundColor Green
Write-Host "✅ Archive structure created" -ForegroundColor Green
Write-Host "✅ Source files migrated (review needed)" -ForegroundColor Green
Write-Host "✅ Old packages archived" -ForegroundColor Green
Write-Host "⚠️  Manual tasks remaining:" -ForegroundColor Yellow
Write-Host "  1. Update remaining import paths" -ForegroundColor Yellow
Write-Host "  2. Update pnpm-workspace.yaml" -ForegroundColor Yellow
Write-Host "  3. Fix any build/test failures" -ForegroundColor Yellow
Write-Host "  4. Commit changes to version control" -ForegroundColor Yellow

Write-Host "`n🎯 Next steps:" -ForegroundColor Cyan
Write-Host "  1. Review migrated files for conflicts" -ForegroundColor Gray
Write-Host "  2. Update import statements throughout codebase" -ForegroundColor Gray
Write-Host "  3. Ensure all tests pass" -ForegroundColor Gray
Write-Host "  4. Begin implementing institutional features" -ForegroundColor Gray 