#!/bin/bash
# Repository Cleanup Execution Script
# Date: November 9, 2025
# Purpose: Archive outdated documentation and organize repository structure

set -e  # Exit on error

echo "=========================================="
echo "Noderr Repository Cleanup Script"
echo "=========================================="
echo ""

# Safety check
echo "This script will:"
echo "1. Move AUDIT directory to archive/old_audits_2024/"
echo "2. Move outdated phase reports to archive/old_reports_2024/"
echo "3. Organize floor-engine weekly reports"
echo "4. Update main README with new documentation links"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
    echo "Cleanup cancelled."
    exit 1
fi

echo ""
echo "Starting cleanup..."
echo ""

# Step 1: Move AUDIT directory
echo "[1/5] Moving AUDIT directory to archive..."
if [ -d "AUDIT" ]; then
    git mv AUDIT archive/old_audits_2024/
    echo "✓ AUDIT directory archived"
else
    echo "⚠ AUDIT directory not found, skipping"
fi

# Step 2: Move outdated phase reports from cursor_compatible
echo "[2/5] Archiving outdated phase reports..."
cd cursor_compatible

reports_to_archive=(
    "PAPER_MODE_PHASE1_REPORT.md"
    "PAPER_MODE_PHASE2_REPORT.md"
    "PAPER_MODE_PHASE3_REPORT.md"
    "PHASE3_IMPLEMENTATION_SUMMARY.md"
    "STRATEGY_ENGINE_PHASE5_REPORT.md"
    "ML_ENGINE_PHASE6_REPORT.md"
    "PAPER_MODE_BENCHMARK.md"
)

for report in "${reports_to_archive[@]}"; do
    if [ -f "$report" ]; then
        git mv "$report" ../archive/old_reports_2024/
        echo "✓ Archived $report"
    else
        echo "⚠ $report not found, skipping"
    fi
done

cd ..

# Step 3: Organize floor-engine weekly reports
echo "[3/5] Organizing floor-engine weekly reports..."
cd packages/floor-engine

if [ ! -d "archive" ]; then
    mkdir -p archive/weekly_reports
fi

weekly_reports=(
    "WEEK_2_SUMMARY.md"
    "WEEK_3_SUMMARY.md"
    "WEEK_4_SUMMARY.md"
    "WEEK_5_SUMMARY.md"
    "WEEK_5_VERIFICATION.md"
    "WEEK_5_VERIFICATION_REPORT.md"
    "WEEK_6_SUMMARY.md"
    "WEEK_6_VERIFICATION.md"
    "WEEK_7_SUMMARY.md"
    "VERIFICATION_WEEK1.md"
    "WEEK_5_INTEGRATION_PLAN.md"
    "WEEK_6_PLAN.md"
    "WEEK_7_MASTER_PLAN.md"
)

for report in "${weekly_reports[@]}"; do
    if [ -f "$report" ]; then
        git mv "$report" archive/weekly_reports/
        echo "✓ Moved $report to archive"
    else
        echo "⚠ $report not found, skipping"
    fi
done

cd ../..

# Step 4: Create docs index
echo "[4/5] Creating documentation index..."
cat > docs/README.md << 'EOF'
# Noderr Documentation

## Analysis & Strategy

- [ML/AI Optimization Analysis](./analysis/ML_AI_OPTIMIZATION_ANALYSIS.md) - Comprehensive evaluation of ML/AI optimization proposals
- [System Architecture Findings](./analysis/SYSTEM_ARCHITECTURE_FINDINGS.md) - Detailed findings from repository analysis
- [Optimization Priorities Matrix](./analysis/OPTIMIZATION_PRIORITIES_MATRIX.txt) - Comparison of competing roadmaps

## Architecture

- [System Architecture](../cursor_compatible/packages/SYSTEM_ARCHITECTURE.md) - Overall system architecture
- [Floor Engine Architecture](../cursor_compatible/packages/FLOOR_ENGINE_ARCHITECTURE.md) - Floor engine design

## Maintenance

- [Cleanup Plan](./CLEANUP_PLAN.md) - Repository cleanup and organization plan

## Archive

Historical documentation and reports are archived in:
- `../archive/old_audits_2024/` - Previous audit reports
- `../archive/old_reports_2024/` - Outdated phase reports
- `../packages/floor-engine/archive/` - Weekly development reports

---

**Last Updated**: November 9, 2025
EOF

echo "✓ Created docs/README.md"

# Step 5: Update main README
echo "[5/5] Updating main README..."

# Check if README.md exists
if [ -f "README.md" ]; then
    # Add documentation section if it doesn't exist
    if ! grep -q "## Documentation" README.md; then
        cat >> README.md << 'EOF'

## Documentation

Comprehensive documentation is available in the [`docs/`](./docs/) directory:

- **[ML/AI Optimization Analysis](./docs/analysis/ML_AI_OPTIMIZATION_ANALYSIS.md)** - Strategic analysis of ML/AI optimization proposals
- **[System Architecture Findings](./docs/analysis/SYSTEM_ARCHITECTURE_FINDINGS.md)** - Detailed repository analysis
- **[Documentation Index](./docs/README.md)** - Complete documentation catalog

Historical documentation has been archived to preserve repository history while maintaining clarity.

EOF
        echo "✓ Updated README.md with documentation links"
    else
        echo "⚠ Documentation section already exists in README.md"
    fi
else
    echo "⚠ README.md not found, skipping update"
fi

echo ""
echo "=========================================="
echo "Cleanup Complete!"
echo "=========================================="
echo ""
echo "Summary:"
echo "- AUDIT directory archived"
echo "- Outdated phase reports archived"
echo "- Floor-engine weekly reports organized"
echo "- Documentation index created"
echo "- Main README updated"
echo ""
echo "Next steps:"
echo "1. Review changes: git status"
echo "2. Commit changes: git commit -m 'docs: reorganize documentation and archive outdated reports'"
echo "3. Push to GitHub: git push origin main"
echo ""
