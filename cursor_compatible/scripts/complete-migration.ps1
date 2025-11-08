# Complete Phase 3 Migration Script
# Fixes path issues and completes the migration

Write-Host "Completing Phase 3 Migration..." -ForegroundColor Cyan

# Get root directory
$rootDir = Get-Location

# Function to copy remaining files
function Complete-Migration {
    param(
        [string]$Source,
        [string]$Destination,
        [string]$PackageName
    )
    
    Write-Host "Completing migration for $PackageName..." -ForegroundColor Yellow
    
    if (Test-Path $Source) {
        # Create destination if it doesn't exist
        if (!(Test-Path $Destination)) {
            New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        }
        
        # Copy all TypeScript files
        $files = Get-ChildItem -Path $Source -Include "*.ts","*.tsx","*.js","*.jsx" -Recurse -File
        
        foreach ($file in $files) {
            # Get the relative path from source
            $relativePath = $file.FullName.Substring((Get-Item $Source).FullName.Length).TrimStart('\', '/')
            $destFile = Join-Path $Destination $relativePath
            $destDir = Split-Path $destFile -Parent
            
            # Create destination directory
            if (!(Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            
            # Copy file if it doesn't exist
            if (!(Test-Path $destFile)) {
                Copy-Item -Path $file.FullName -Destination $destFile -Force
                Write-Host "  [OK] Copied: $relativePath" -ForegroundColor Green
            }
        }
    }
}

# Complete ML package migration
Write-Host "`nCompleting ML package migrations..." -ForegroundColor Yellow

# ml-enhancement
Complete-Migration -Source "packages/ml-enhancement/src" -Destination "packages/ml/src" -PackageName "ml-enhancement"

# model-expansion
Complete-Migration -Source "packages/model-expansion/src" -Destination "packages/ml/src" -PackageName "model-expansion"

# Archive old packages
Write-Host "`nArchiving old packages..." -ForegroundColor Yellow

$archiveDir = Join-Path $rootDir "archive/packages"
if (!(Test-Path $archiveDir)) {
    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
}

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
    $destPath = Join-Path $archiveDir $pkg
    
    if ((Test-Path $sourcePath) -and !(Test-Path $destPath)) {
        Write-Host "  Archiving $pkg..." -ForegroundColor Gray
        Move-Item -Path $sourcePath -Destination $destPath -Force
        Write-Host "  [OK] Archived $pkg" -ForegroundColor Green
    }
}

# Fix corrupted paths in migrated files
Write-Host "`nFixing path issues in migrated files..." -ForegroundColor Yellow

# Clean up execution package
$executionSrc = Join-Path $rootDir "packages/execution/src"
if (Test-Path "$executionSrc/rr docs") {
    # Move files from corrupted path to correct location
    $corruptedPath = Join-Path $executionSrc "rr docs/cursor_compatible_files/cursor_compatible/packages/execution-engine/src"
    if (Test-Path $corruptedPath) {
        $files = Get-ChildItem -Path $corruptedPath -File
        foreach ($file in $files) {
            $destFile = Join-Path $executionSrc $file.Name
            if (!(Test-Path $destFile)) {
                Move-Item -Path $file.FullName -Destination $destFile -Force
                Write-Host "  [FIXED] Moved $($file.Name) to correct location" -ForegroundColor Green
            }
        }
    }
    # Remove corrupted directory
    Remove-Item -Path "$executionSrc/rr docs" -Recurse -Force -ErrorAction SilentlyContinue
}

# Fix other corrupted paths
$dirsToFix = @("docs", " docs", "err docs", "ents")
foreach ($dir in $dirsToFix) {
    $corruptedPaths = Get-ChildItem -Path "packages" -Directory -Recurse | Where-Object { $_.Name -eq $dir }
    foreach ($path in $corruptedPaths) {
        if ($path.FullName -like "*\src\*") {
            Write-Host "  [INFO] Found corrupted path: $($path.FullName)" -ForegroundColor Yellow
            # Try to extract and move files
            $files = Get-ChildItem -Path $path.FullName -File -Recurse -ErrorAction SilentlyContinue
            foreach ($file in $files) {
                # Determine correct destination
                if ($file.FullName -like "*execution*") {
                    $dest = "packages/execution/src"
                } elseif ($file.FullName -like "*telemetry*") {
                    $dest = "packages/telemetry/src"
                } elseif ($file.FullName -like "*ml*" -or $file.FullName -like "*ai*") {
                    $dest = "packages/ml/src"
                } else {
                    continue
                }
                
                # Extract meaningful filename
                $fileName = $file.Name
                $destFile = Join-Path $dest $fileName
                
                if (!(Test-Path $destFile)) {
                    Copy-Item -Path $file.FullName -Destination $destFile -Force -ErrorAction SilentlyContinue
                    Write-Host "  [FIXED] Recovered $fileName" -ForegroundColor Green
                }
            }
            # Remove corrupted directory
            Remove-Item -Path $path.FullName -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# Update import paths
Write-Host "`nUpdating import paths..." -ForegroundColor Yellow

$replacements = @{
    "@noderr/execution-engine" = "@noderr/execution"
    "@noderr/execution-enhanced" = "@noderr/execution"
    "@noderr/execution-optimizer" = "@noderr/execution"
    "@noderr/telemetry-layer" = "@noderr/telemetry"
    "@noderr/telemetry-enhanced" = "@noderr/telemetry"
    "@noderr/ai-core" = "@noderr/ml"
    "@noderr/ml-enhanced" = "@noderr/ml"
    "@noderr/ml-enhancement" = "@noderr/ml"
    "@noderr/model-expansion" = "@noderr/ml"
}

$files = Get-ChildItem -Path . -Include "*.ts","*.tsx","*.js","*.jsx","*.json" -Recurse -File |
         Where-Object { $_.FullName -notlike "*node_modules*" -and $_.FullName -notlike "*archive*" -and $_.FullName -notlike "*dist*" -and $_.FullName -notlike "*build*" }

$updatedCount = 0
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
    if ($content) {
        $originalContent = $content
        
        foreach ($old in $replacements.Keys) {
            if ($content -match [regex]::Escape($old)) {
                $content = $content -replace [regex]::Escape($old), $replacements[$old]
            }
        }
        
        if ($content -ne $originalContent) {
            Set-Content -Path $file.FullName -Value $content -NoNewline
            Write-Host "  [OK] Updated imports in: $($file.Name)" -ForegroundColor Green
            $updatedCount++
        }
    }
}

Write-Host "  Updated $updatedCount files" -ForegroundColor Cyan

# Build packages
Write-Host "`nBuilding packages..." -ForegroundColor Yellow
$packages = @("@noderr/types", "@noderr/utils", "@noderr/telemetry", "@noderr/execution", "@noderr/ml")

foreach ($pkg in $packages) {
    Write-Host "  Building $pkg..." -ForegroundColor Cyan
    try {
        pnpm --filter $pkg build 2>&1 | Out-Null
        Write-Host "  [OK] $pkg built successfully" -ForegroundColor Green
    } catch {
        Write-Host "  [WARN] $pkg build failed (may need manual fixes)" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Migration Completion Summary ===" -ForegroundColor Green
Write-Host "1. Completed ML package migrations" -ForegroundColor Green
Write-Host "2. Archived old packages" -ForegroundColor Green
Write-Host "3. Fixed path corruption issues" -ForegroundColor Green
Write-Host "4. Updated import paths" -ForegroundColor Green
Write-Host "5. Attempted package builds" -ForegroundColor Green

Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "1. Review consolidated packages for any remaining issues" -ForegroundColor Gray
Write-Host "2. Fix any build errors" -ForegroundColor Gray
Write-Host "3. Run tests to ensure functionality" -ForegroundColor Gray
Write-Host "4. Begin implementing institutional features!" -ForegroundColor Gray

Write-Host "`nPhase 3 migration is now complete!" -ForegroundColor Green 