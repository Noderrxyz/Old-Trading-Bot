# Noderr Version Control Guide

This document outlines our version control practices for the Noderr trading protocol.

## Git Workflow

We follow a modified Git Flow workflow:

1. **Feature Development**:
   - Create a feature branch: `feature/your-feature-name`
   - Make changes and commit regularly
   - Push to remote to share work in progress
   - Create a pull request when ready

2. **Bug Fixes**:
   - Create a bugfix branch: `bugfix/issue-description`
   - Fix the issue and add tests
   - Create a pull request

3. **Hotfixes** (for urgent production issues):
   - Create a hotfix branch: `hotfix/critical-issue`
   - Fix the issue
   - Create a pull request for immediate review

## Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

Types:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code changes that neither fix a bug nor add a feature
- `perf`: Performance improvements
- `test`: Adding or fixing tests
- `chore`: Changes to the build process, tooling, etc.

Examples:
```
feat(market-data): add Binance adapter
fix(trading): correctly calculate position size
docs(readme): update installation instructions
```

## Pull Request Process

1. **Create a PR**:
   - Ensure all tests pass
   - Include relevant documentation
   - Reference any related issues

2. **Code Review**:
   - At least one review is required
   - Address all comments

3. **Merge**:
   - Squash and merge is preferred
   - Delete the branch after merging

## Versioning

We use [Semantic Versioning](https://semver.org/):

- **Major** (X.0.0): Breaking changes
- **Minor** (0.X.0): New features, non-breaking
- **Patch** (0.0.X): Bug fixes, non-breaking

## Release Tags

Tag all releases with the version number:

```bash
git tag -a v1.2.3 -m "Release v1.2.3"
git push origin v1.2.3
```

## Maintaining a Clean History

- Rebase feature branches on `develop` regularly
- Avoid merge commits when possible
- Squash trivial commits before merging

## Code Owners

The `CODEOWNERS` file defines who is responsible for reviewing changes to specific parts of the codebase.

## Protected Branches

- `main` / `master`: Production code
- `develop`: Integration branch
- Both require passing CI and approved reviews 