# Setting Up GitHub in Cursor

Cursor has built-in Git integration that makes it easy to push to GitHub without using the command line. Here's how to set it up:

## Step 1: Install Git (if needed)

Cursor needs Git installed on your system:
- Download from: https://git-scm.com/download/win
- During installation, make sure to check "Add Git to PATH" option
- Restart Cursor after installation

## Step 2: Initialize Repository in Cursor

1. **Open Source Control Panel**:
   - Click the Source Control icon in the left sidebar (looks like a branch/fork icon)
   - Or press `Ctrl+Shift+G`

2. **Initialize Repository**:
   - If you see "Initialize Repository" button, click it
   - This will create a `.git` folder in your project

## Step 3: Make Your First Commit

1. In the Source Control panel, you'll see all your files listed as changes
2. Click the "+" icon next to "Changes" to stage all files (or stage individual files)
3. Type a commit message in the text box (e.g., "Initial commit: Noderr Trading Bot")
4. Click the checkmark icon (✓) or press `Ctrl+Enter` to commit

## Step 4: Connect to GitHub

### Option A: Using Cursor's GitHub Integration

1. **Sign in to GitHub**:
   - Click the account icon in the bottom left corner of Cursor
   - Select "Sign in with GitHub"
   - Authorize Cursor to access your GitHub account

2. **Publish to GitHub**:
   - In the Source Control panel, look for "Publish Branch" button
   - Click it
   - Choose to create a new repository on GitHub
   - Enter your repository name
   - Choose public or private
   - Click "Publish"

### Option B: Manual Remote Setup

If you've already created a repository on GitHub:

1. **Open Command Palette**:
   - Press `Ctrl+Shift+P`
   - Type "Git: Add Remote"
   - Enter your repository URL: `https://github.com/YOUR_USERNAME/REPO_NAME.git`
   - Name it "origin"

2. **Push to GitHub**:
   - In Source Control panel, click the "..." menu (three dots)
   - Select "Push" or "Push to..."
   - Choose "origin" and your branch (usually "main" or "master")

## Step 5: Future Pushes

After the initial setup, pushing is simple:

1. Make your changes
2. Stage files (click "+" next to files)
3. Commit with a message
4. Click the "Sync Changes" button (circular arrows icon) or use the "..." menu → "Push"

## Troubleshooting

- **"Git not found"**: Install Git and restart Cursor
- **"Authentication failed"**: 
  - Use a Personal Access Token instead of password
  - Generate at: https://github.com/settings/tokens
  - When prompted, use the token as your password
- **"Repository not found"**: Make sure the repository exists on GitHub and you have access
- **Can't see Source Control**: Press `Ctrl+Shift+G` or click the branch icon in the sidebar

## Using Cursor's Git Features

Cursor provides several Git features:
- **Branch management**: Click the branch name at the bottom to switch/create branches
- **Diff view**: Click any file in Source Control to see changes
- **Commit history**: View commit history in the Source Control panel
- **Merge conflicts**: Cursor will highlight conflicts and help you resolve them


