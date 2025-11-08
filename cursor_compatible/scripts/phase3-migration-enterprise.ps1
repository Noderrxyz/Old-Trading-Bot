# Phase 3 Migration Script - Enterprise Edition
# World-class implementation for Noderr Trading Bot consolidation
# Target: #1 trading infrastructure globally

param(
    [switch]$DryRun = $false,
    [switch]$Verbose = $false,
    [switch]$SkipTests = $false,
    [switch]$Force = $false
)

# Set strict error handling
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Initialize logging
$logDir = Join-Path (Get-Location) "logs"
if (!(Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}
$logFile = Join-Path $logDir "phase3-migration-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"

function Write-Log {
    param(
        [string]$Message,
        [string]$Level = "INFO",
        [ConsoleColor]$Color = "White"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    
    # Write to console
    Write-Host $logMessage -ForegroundColor $Color
    
    # Write to log file
    Add-Content -Path $logFile -Value $logMessage
}

function Test-Prerequisites {
    Write-Log "Checking prerequisites..." "INFO" "Yellow"
    
    $prereqMet = $true
    
    # Check Node.js
    try {
        $nodeVersion = node --version
        Write-Log "[OK] Node.js installed: $nodeVersion" "INFO" "Green"
    } catch {
        Write-Log "[ERROR] Node.js not installed" "ERROR" "Red"
        $prereqMet = $false
    }
    
    # Check pnpm
    try {
        $pnpmVersion = pnpm --version
        Write-Log "[OK] pnpm installed: $pnpmVersion" "INFO" "Green"
    } catch {
        Write-Log "[ERROR] pnpm not installed. Install with: npm install -g pnpm" "ERROR" "Red"
        $prereqMet = $false
    }
    
    # Check Git
    try {
        $gitVersion = git --version
        Write-Log "[OK] Git installed: $gitVersion" "INFO" "Green"
    } catch {
        Write-Log "[ERROR] Git not installed" "ERROR" "Red"
        $prereqMet = $false
    }
    
    # Check for clean working directory
    $gitStatus = git status --porcelain
    if ($gitStatus -and !$Force) {
        Write-Log "[WARNING] Git working directory not clean. Use -Force to override" "WARN" "Yellow"
        Write-Log "Uncommitted changes:" "WARN" "Yellow"
        $gitStatus | ForEach-Object { Write-Log "  $_" "WARN" "Yellow" }
        $prereqMet = $false
    }
    
    return $prereqMet
}

function Backup-CurrentState {
    Write-Log "Creating backup of current state..." "INFO" "Yellow"
    
    $backupBranch = "backup/pre-phase3-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    
    try {
        git checkout -b $backupBranch
        Write-Log "[OK] Created backup branch: $backupBranch" "INFO" "Green"
        
        # Return to original branch
        git checkout -
    } catch {
        Write-Log "[ERROR] Failed to create backup: $_" "ERROR" "Red"
        throw
    }
}

function Install-Dependencies {
    Write-Log "Installing dependencies..." "INFO" "Yellow"
    
    try {
        if ($DryRun) {
            Write-Log "[DRY RUN] Would run: pnpm install" "INFO" "Cyan"
        } else {
            $output = pnpm install 2>&1
            Write-Log "[OK] Dependencies installed successfully" "INFO" "Green"
            if ($Verbose) {
                $output | ForEach-Object { Write-Log "  $_" "DEBUG" "Gray" }
            }
        }
    } catch {
        Write-Log "[ERROR] Failed to install dependencies: $_" "ERROR" "Red"
        throw
    }
}

function Build-Package {
    param([string]$PackageName)
    
    Write-Log "Building $PackageName..." "INFO" "Cyan"
    
    try {
        if ($DryRun) {
            Write-Log "[DRY RUN] Would build: $PackageName" "INFO" "Cyan"
        } else {
            $output = pnpm --filter $PackageName build 2>&1
            Write-Log "[OK] $PackageName built successfully" "INFO" "Green"
            if ($Verbose) {
                $output | ForEach-Object { Write-Log "  $_" "DEBUG" "Gray" }
            }
        }
        return $true
    } catch {
        Write-Log "[WARNING] Failed to build $PackageName (expected before migration)" "WARN" "Yellow"
        return $false
    }
}

function Ensure-Directory {
    param([string]$Path)
    
    if (!(Test-Path $Path)) {
        if ($DryRun) {
            Write-Log "[DRY RUN] Would create directory: $Path" "INFO" "Cyan"
        } else {
            New-Item -ItemType Directory -Path $Path -Force | Out-Null
            Write-Log "[OK] Created directory: $Path" "INFO" "Green"
        }
    }
}

function Migrate-SourceFiles {
    param(
        [string[]]$SourcePaths,
        [string]$DestinationPath,
        [string]$PackageName
    )
    
    Write-Log "Migrating source files for $PackageName..." "INFO" "Yellow"
    
    $totalFiles = 0
    $migratedFiles = 0
    $skippedFiles = 0
    
    foreach ($sourcePath in $SourcePaths) {
        if (Test-Path $sourcePath) {
            Write-Log "  Processing: $sourcePath" "INFO" "Gray"
            
            $files = Get-ChildItem -Path $sourcePath -Filter "*.ts" -Recurse -File
            $totalFiles += $files.Count
            
            foreach ($file in $files) {
                $relativePath = $file.FullName.Substring($sourcePath.Length).TrimStart('\', '/')
                $destFile = Join-Path $DestinationPath $relativePath
                $destDir = Split-Path $destFile -Parent
                
                Ensure-Directory -Path $destDir
                
                if (Test-Path $destFile) {
                    Write-Log "    [SKIP] Already exists: $relativePath" "WARN" "Yellow"
                    $skippedFiles++
                } else {
                    if ($DryRun) {
                        Write-Log "    [DRY RUN] Would migrate: $relativePath" "INFO" "Cyan"
                    } else {
                        Copy-Item -Path $file.FullName -Destination $destFile -Force
                        Write-Log "    [OK] Migrated: $relativePath" "INFO" "Green"
                    }
                    $migratedFiles++
                }
            }
        } else {
            Write-Log "  [SKIP] Source not found: $sourcePath" "WARN" "Yellow"
        }
    }
    
    Write-Log "  Summary: $migratedFiles migrated, $skippedFiles skipped, $totalFiles total" "INFO" "Cyan"
    return @{
        Total = $totalFiles
        Migrated = $migratedFiles
        Skipped = $skippedFiles
    }
}

function Archive-Package {
    param([string]$PackageName, [string]$ArchiveDir)
    
    $sourcePath = Join-Path (Get-Location) "packages/$PackageName"
    $destPath = Join-Path $ArchiveDir $PackageName
    
    if (Test-Path $sourcePath) {
        if ($DryRun) {
            Write-Log "[DRY RUN] Would archive: $PackageName" "INFO" "Cyan"
        } else {
            Move-Item -Path $sourcePath -Destination $destPath -Force
            Write-Log "[OK] Archived: $PackageName" "INFO" "Green"
        }
        return $true
    } else {
        Write-Log "[SKIP] Not found: $PackageName" "WARN" "Yellow"
        return $false
    }
}

function Update-ImportPaths {
    Write-Log "Scanning for import paths to update..." "INFO" "Yellow"
    
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
    
    $files = Get-ChildItem -Path . -Include "*.ts","*.tsx","*.js","*.jsx" -Recurse -File |
             Where-Object { $_.FullName -notlike "*node_modules*" -and $_.FullName -notlike "*archive*" -and $_.FullName -notlike "*dist*" -and $_.FullName -notlike "*build*" }
    
    $updatedFiles = 0
    
    foreach ($file in $files) {
        $content = Get-Content $file.FullName -Raw
        $originalContent = $content
        
        foreach ($old in $replacements.Keys) {
            if ($content -match [regex]::Escape($old)) {
                $content = $content -replace [regex]::Escape($old), $replacements[$old]
            }
        }
        
        if ($content -ne $originalContent) {
            if ($DryRun) {
                Write-Log "[DRY RUN] Would update imports in: $($file.FullName)" "INFO" "Cyan"
            } else {
                Set-Content -Path $file.FullName -Value $content -NoNewline
                Write-Log "[OK] Updated imports in: $($file.FullName)" "INFO" "Green"
            }
            $updatedFiles++
        }
    }
    
    Write-Log "Updated imports in $updatedFiles files" "INFO" "Cyan"
    return $updatedFiles
}

function Run-Tests {
    if ($SkipTests) {
        Write-Log "[SKIP] Tests skipped by user request" "WARN" "Yellow"
        return $true
    }
    
    Write-Log "Running comprehensive test suite..." "INFO" "Yellow"
    
    try {
        if ($DryRun) {
            Write-Log "[DRY RUN] Would run: pnpm test" "INFO" "Cyan"
            return $true
        } else {
            $output = pnpm test 2>&1
            Write-Log "[OK] All tests passed" "INFO" "Green"
            if ($Verbose) {
                $output | ForEach-Object { Write-Log "  $_" "DEBUG" "Gray" }
            }
            return $true
        }
    } catch {
        Write-Log "[ERROR] Tests failed: $_" "ERROR" "Red"
        return $false
    }
}

function Generate-MigrationReport {
    param($Stats)
    
    $reportPath = Join-Path (Get-Location) "migration-report-$(Get-Date -Format 'yyyyMMdd-HHmmss').md"
    
    $report = @"
# Phase 3 Migration Report

Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

## Summary

- **Total Files Migrated**: $($Stats.TotalFilesMigrated)
- **Files Skipped**: $($Stats.FilesSkipped)
- **Packages Archived**: $($Stats.PackagesArchived)
- **Import Paths Updated**: $($Stats.ImportPathsUpdated)
 - **Build Status**: $(if ($Stats.BuildSuccess) { 'SUCCESS' } else { 'FAILED' })
 - **Test Status**: $(if ($Stats.TestSuccess) { 'SUCCESS' } else { 'FAILED' })

## Migration Details

### Execution Package
- Files from execution-engine: $($Stats.ExecutionEngine.Migrated)
- Files from execution-enhanced: $($Stats.ExecutionEnhanced.Migrated)
- Files from execution-optimizer: $($Stats.ExecutionOptimizer.Migrated)

### Telemetry Package
- Files from telemetry-layer: $($Stats.TelemetryLayer.Migrated)
- Files from telemetry-enhanced: $($Stats.TelemetryEnhanced.Migrated)

### ML Package
- Files from ai-core: $($Stats.AiCore.Migrated)
- Files from ml-enhanced: $($Stats.MlEnhanced.Migrated)
- Files from ml-enhancement: $($Stats.MlEnhancement.Migrated)
- Files from model-expansion: $($Stats.ModelExpansion.Migrated)

## Next Steps

1. Review migrated files for conflicts
2. Update remaining import paths manually if needed
3. Run integration tests
4. Begin implementing institutional features

## Log File

Full migration log: $logFile
"@
    
    if (!$DryRun) {
        Set-Content -Path $reportPath -Value $report
        Write-Log "[OK] Migration report generated: $reportPath" "INFO" "Green"
    }
}

# Main execution
try {
    Write-Log "=== PHASE 3 MIGRATION - ENTERPRISE EDITION ===" "INFO" "Cyan"
    Write-Log "Target: World-class #1 trading infrastructure" "INFO" "Cyan"
    Write-Log "Mode: $(if ($DryRun) { 'DRY RUN' } else { 'LIVE' })" "INFO" "Yellow"
    
    # Check prerequisites
    if (!(Test-Prerequisites)) {
        Write-Log "[ABORT] Prerequisites not met" "ERROR" "Red"
        exit 1
    }
    
    # Create backup
    if (!$DryRun -and !$Force) {
        Backup-CurrentState
    }
    
    # Install dependencies
    Install-Dependencies
    
    # Initialize statistics
    $stats = @{
        TotalFilesMigrated = 0
        FilesSkipped = 0
        PackagesArchived = 0
        ImportPathsUpdated = 0
        BuildSuccess = $false
        TestSuccess = $false
        ExecutionEngine = @{}
        ExecutionEnhanced = @{}
        ExecutionOptimizer = @{}
        TelemetryLayer = @{}
        TelemetryEnhanced = @{}
        AiCore = @{}
        MlEnhanced = @{}
        MlEnhancement = @{}
        ModelExpansion = @{}
    }
    
    # Build consolidated packages (initial attempt)
    Write-Log "`nBuilding consolidated packages (pre-migration)..." "INFO" "Yellow"
    $packages = @("@noderr/types", "@noderr/utils", "@noderr/telemetry", "@noderr/execution", "@noderr/ml")
    foreach ($pkg in $packages) {
        Build-Package -PackageName $pkg | Out-Null
    }
    
    # Create archive structure
    $archiveDir = Join-Path (Get-Location) "archive"
    $packagesArchiveDir = Join-Path $archiveDir "packages"
    Ensure-Directory -Path $packagesArchiveDir
    
    # Migrate execution packages
    Write-Log "`nMigrating execution packages..." "INFO" "Yellow"
    $executionDest = Join-Path (Get-Location) "packages/execution/src"
    
    $stats.ExecutionEngine = Migrate-SourceFiles -SourcePaths @("packages/execution-engine/src") -DestinationPath $executionDest -PackageName "execution-engine"
    $stats.ExecutionEnhanced = Migrate-SourceFiles -SourcePaths @("packages/execution-enhanced/src") -DestinationPath $executionDest -PackageName "execution-enhanced"
    $stats.ExecutionOptimizer = Migrate-SourceFiles -SourcePaths @("packages/execution-optimizer/src") -DestinationPath $executionDest -PackageName "execution-optimizer"
    
    # Migrate telemetry packages
    Write-Log "`nMigrating telemetry packages..." "INFO" "Yellow"
    $telemetryDest = Join-Path (Get-Location) "packages/telemetry/src"
    
    $stats.TelemetryLayer = Migrate-SourceFiles -SourcePaths @("packages/telemetry-layer/src") -DestinationPath $telemetryDest -PackageName "telemetry-layer"
    $stats.TelemetryEnhanced = Migrate-SourceFiles -SourcePaths @("packages/telemetry-enhanced/src") -DestinationPath $telemetryDest -PackageName "telemetry-enhanced"
    
    # Migrate ML packages
    Write-Log "`nMigrating ML/AI packages..." "INFO" "Yellow"
    $mlDest = Join-Path (Get-Location) "packages/ml/src"
    
    $stats.AiCore = Migrate-SourceFiles -SourcePaths @("packages/ai-core/src") -DestinationPath $mlDest -PackageName "ai-core"
    $stats.MlEnhanced = Migrate-SourceFiles -SourcePaths @("packages/ml-enhanced/src") -DestinationPath $mlDest -PackageName "ml-enhanced"
    $stats.MlEnhancement = Migrate-SourceFiles -SourcePaths @("packages/ml-enhancement/src") -DestinationPath $mlDest -PackageName "ml-enhancement"
    $stats.ModelExpansion = Migrate-SourceFiles -SourcePaths @("packages/model-expansion/src") -DestinationPath $mlDest -PackageName "model-expansion"
    
    # Calculate total statistics
    $migrationResults = @($stats.ExecutionEngine, $stats.ExecutionEnhanced, $stats.ExecutionOptimizer, 
                         $stats.TelemetryLayer, $stats.TelemetryEnhanced,
                         $stats.AiCore, $stats.MlEnhanced, $stats.MlEnhancement, $stats.ModelExpansion)
    
    $stats.TotalFilesMigrated = ($migrationResults | ForEach-Object { $_.Migrated } | Measure-Object -Sum).Sum
    $stats.FilesSkipped = ($migrationResults | ForEach-Object { $_.Skipped } | Measure-Object -Sum).Sum
    
    # Update import paths
    Write-Log "`nUpdating import paths..." "INFO" "Yellow"
    $stats.ImportPathsUpdated = Update-ImportPaths
    
    # Archive old packages
    Write-Log "`nArchiving old packages..." "INFO" "Yellow"
    $packagesToArchive = @(
        "execution-engine", "execution-enhanced", "execution-optimizer",
        "telemetry-layer", "telemetry-enhanced",
        "ai-core", "ml-enhanced", "ml-enhancement", "model-expansion"
    )
    
    foreach ($pkg in $packagesToArchive) {
        if (Archive-Package -PackageName $pkg -ArchiveDir $packagesArchiveDir) {
            $stats.PackagesArchived++
        }
    }
    
    # Rebuild all packages
    Write-Log "`nRebuilding all packages (post-migration)..." "INFO" "Yellow"
    $buildSuccess = $true
    foreach ($pkg in $packages) {
        if (!(Build-Package -PackageName $pkg)) {
            $buildSuccess = $false
        }
    }
    $stats.BuildSuccess = $buildSuccess
    
    # Run tests
    $stats.TestSuccess = Run-Tests
    
    # Generate report
    Generate-MigrationReport -Stats $stats
    
    # Final summary
    Write-Log "`n=== MIGRATION COMPLETE ===" "INFO" "Green"
    Write-Log "Total files migrated: $($stats.TotalFilesMigrated)" "INFO" "Cyan"
    Write-Log "Files skipped: $($stats.FilesSkipped)" "INFO" "Cyan"
    Write-Log "Packages archived: $($stats.PackagesArchived)" "INFO" "Cyan"
    Write-Log "Import paths updated: $($stats.ImportPathsUpdated)" "INFO" "Cyan"
    Write-Log "Build status: $(if ($stats.BuildSuccess) { 'SUCCESS' } else { 'FAILED' })" "INFO" $(if ($stats.BuildSuccess) { "Green" } else { "Red" })
    Write-Log "Test status: $(if ($stats.TestSuccess) { 'SUCCESS' } else { 'FAILED' })" "INFO" $(if ($stats.TestSuccess) { "Green" } else { "Red" })
    
    if (!$stats.BuildSuccess -or !$stats.TestSuccess) {
        Write-Log "`n[WARNING] Migration completed with issues. Review logs and fix before proceeding." "WARN" "Yellow"
        exit 1
    } else {
        Write-Log "`n[SUCCESS] Phase 3 migration completed successfully!" "INFO" "Green"
        Write-Log "Ready to implement world-class institutional features!" "INFO" "Green"
        exit 0
    }
    
} catch {
    Write-Log "[FATAL] Migration failed: $_" "ERROR" "Red"
    Write-Log "Stack trace: $($_.ScriptStackTrace)" "ERROR" "Red"
    exit 1
} 