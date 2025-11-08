# GitHub Setup Instructions

## Prerequisites

1. **Install Git** (if not already installed):
   - Download from: https://git-scm.com/download/win
   - Or use: `winget install Git.Git` (if you have Windows Package Manager)
   - After installation, restart your terminal/PowerShell

2. **Create a GitHub Account** (if you don't have one):
   - Go to: https://github.com
   - Sign up for a free account

3. **Create a New Repository on GitHub**:
   - Go to your GitHub profile
   - Click "New repository"
   - Name it (e.g., "noderr-trading-bot")
   - Choose public or private
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
   - Click "Create repository"

## Setup Steps

### 1. Initialize Git Repository

Open PowerShell in your project directory and run:

```powershell
# Navigate to project root
cd "C:\Users\noder\Documents\Noderr docs\Noderr Trading Bot"

# Initialize git repository
git init

# Configure your Git identity (if not already set)
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

### 2. Add Files to Git

```powershell
# Add all files (respecting .gitignore)
git add .

# Check what will be committed
git status

# Make your first commit
git commit -m "Initial commit: Noderr Trading Bot"
```

### 3. Connect to GitHub

```powershell
# Add your GitHub repository as remote (replace YOUR_USERNAME and REPO_NAME)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Verify the remote was added
git remote -v
```

### 4. Push to GitHub

```powershell
# Rename default branch to main (if needed)
git branch -M main

# Push to GitHub
git push -u origin main
```

If you're prompted for credentials:
- **Username**: Your GitHub username
- **Password**: Use a Personal Access Token (not your GitHub password)
  - Generate one at: https://github.com/settings/tokens
  - Select scope: `repo` (full control of private repositories)

## Alternative: Using SSH (Recommended for Security)

If you prefer SSH authentication:

1. **Generate SSH Key**:
   ```powershell
   ssh-keygen -t ed25519 -C "your.email@example.com"
   # Press Enter to accept default location
   # Optionally set a passphrase
   ```

2. **Add SSH Key to GitHub**:
   ```powershell
   # Copy your public key
   cat ~/.ssh/id_ed25519.pub
   ```
   - Go to: https://github.com/settings/keys
   - Click "New SSH key"
   - Paste your public key

3. **Use SSH URL for remote**:
   ```powershell
   git remote set-url origin git@github.com:YOUR_USERNAME/REPO_NAME.git
   git push -u origin main
   ```

## Important Notes

- The `.gitignore` file will exclude:
  - `node_modules/` (dependencies)
  - `*.log` files (logs)
  - `.env` files (environment variables with secrets)
  - Build outputs (`dist/`, `build/`)
  - Large data files in `data/crypto/` and `data/paper_trading/`
  - Archives like `cursor_compatible.zip`

- **Before pushing, make sure**:
  - No sensitive API keys or secrets are in your code
  - All `.env` files are in `.gitignore` (they are)
  - Large files are excluded (consider Git LFS for large data files if needed)

## Future Updates

After making changes:

```powershell
git add .
git commit -m "Description of your changes"
git push
```

## Troubleshooting

- **"Git is not recognized"**: Restart PowerShell after installing Git
- **"Permission denied"**: Check your GitHub credentials or SSH key setup
- **"Repository not found"**: Verify the repository name and your access permissions
- **Large file errors**: Consider using Git LFS for files over 100MB


