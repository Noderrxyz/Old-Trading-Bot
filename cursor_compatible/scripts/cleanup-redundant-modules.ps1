# Noderr Trading Bot - Cleanup Redundant Modules Script
# This script archives redundant modules identified in the implementation plan

Write-Host "Starting cleanup of redundant modules..." -ForegroundColor Green

# Create archive directory
$archiveDir = "archive/redundant_modules"
if (!(Test-Path $archiveDir)) {
    New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null
    Write-Host "Created archive directory: $archiveDir" -ForegroundColor Yellow
}

# Define redundant files to archive
$redundantFiles = @(
    "src/execution/ExecutionStrategyRouterJs.ts",
    "src/sim/ReplayEngine.ts",
    "src/simulation/replay_engine.ts",
    "src/simulation/historical_replay_engine.ts",
    "src/simulation/historical_market_replay_engine.ts",
    "src/simulation/HistoricalReplayEngine.ts"
)

# Define redundant packages to archive
$redundantPackages = @(
    "packages/system-vanguard",
    "packages/meta-governance"
)

# Archive redundant files
Write-Host "`nArchiving redundant files..." -ForegroundColor Cyan
foreach ($file in $redundantFiles) {
    if (Test-Path $file) {
        $destPath = Join-Path $archiveDir (Split-Path $file -Leaf)
        Move-Item -Path $file -Destination $destPath -Force
        Write-Host "  Archived: $file -> $destPath" -ForegroundColor Gray
    } else {
        Write-Host "  Not found: $file" -ForegroundColor DarkGray
    }
}

# Archive redundant packages
Write-Host "`nArchiving redundant packages..." -ForegroundColor Cyan
foreach ($package in $redundantPackages) {
    if (Test-Path $package) {
        $packageName = Split-Path $package -Leaf
        $destPath = Join-Path $archiveDir $packageName
        Move-Item -Path $package -Destination $destPath -Force
        Write-Host "  Archived: $package -> $destPath" -ForegroundColor Gray
    } else {
        Write-Host "  Not found: $package" -ForegroundColor DarkGray
    }
}

# Update pnpm-workspace.yaml
Write-Host "`nUpdating pnpm-workspace.yaml..." -ForegroundColor Cyan
$workspaceFile = "pnpm-workspace.yaml"
if (Test-Path $workspaceFile) {
    $content = Get-Content $workspaceFile -Raw
    
    # Remove references to archived packages
    $content = $content -replace '.*system-vanguard.*\n', ''
    $content = $content -replace '.*meta-governance.*\n', ''
    
    Set-Content -Path $workspaceFile -Value $content.TrimEnd()
    Write-Host "  Updated workspace configuration" -ForegroundColor Gray
}

# Update root package.json
Write-Host "`nUpdating root package.json..." -ForegroundColor Cyan
$packageJsonFile = "package.json"
if (Test-Path $packageJsonFile) {
    $packageJson = Get-Content $packageJsonFile -Raw | ConvertFrom-Json
    
    # Remove workspace references if they exist
    if ($packageJson.workspaces) {
        $packageJson.workspaces = $packageJson.workspaces | Where-Object {
            $_ -notmatch 'system-vanguard|meta-governance'
        }
    }
    
    $packageJson | ConvertTo-Json -Depth 10 | Set-Content $packageJsonFile
    Write-Host "  Updated package.json" -ForegroundColor Gray
}

Write-Host "`nCleanup completed successfully!" -ForegroundColor Green
Write-Host "Archived files and packages can be found in: $archiveDir" -ForegroundColor Yellow

# Generate cleanup report
$report = @"
Cleanup Report - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
================================================

Archived Files:
$($redundantFiles -join "`n")

Archived Packages:
$($redundantPackages -join "`n")

Archive Location: $archiveDir
"@

$reportFile = Join-Path $archiveDir "cleanup-report.txt"
Set-Content -Path $reportFile -Value $report
Write-Host "`nCleanup report saved to: $reportFile" -ForegroundColor Cyan 