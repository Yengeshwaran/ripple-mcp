# Team Setup Guide

This guide is for the Ripple hackathon team.

> Kiro Crew docs: https://kiro.dev/docs/crew/
>
> Kiro Crew requires its own setup and a configured agent backend. It is **not** installed automatically with this repository.

## 1) Install required tools

Install these first:
- Git
- Node.js (LTS)
- npm (bundled with Node.js)
- A code editor/IDE
- Any coding agent tooling you use (including Kiro Crew, configured separately)

Verify in **Windows PowerShell**:

```powershell
git --version
node --version
npm --version
```

## 2) Accept GitHub collaborator invitation

1. Open GitHub notifications/email.
2. Accept the invite to `Yengeshwaran/ripple-mcp`.
3. Confirm repository access in browser.

## 3) Clone repository and install dependencies (when available)

```powershell
git clone https://github.com/Yengeshwaran/ripple-mcp.git
cd ripple-mcp
```

At this scaffolding stage, there may be no installable app yet. When package manifests are added later:

```powershell
npm install
```

## 4) Create and switch to your feature branch

Always branch from the latest `main`:

```powershell
git checkout main
git pull origin main
git checkout -b feature/<your-scope>
```

Expected hackathon branches:
- `feature/mcp-backend`
- `feature/web-ui`
- `feature/voice-agent`

These branches must be created separately after repository creation.

## 5) Open repository in your coding agent (including Kiro Crew)

1. Open the repo folder in your preferred editor.
2. Connect your coding agent according to that tool's documentation.
3. For Kiro Crew, follow the official setup docs and confirm your agent backend is configured.

## 6) Use Kiro Crew safely

Before applying generated changes:
1. Inspect existing code first.
2. Request small, scoped edits.
3. Review every diff before commit.
4. Run tests/checks relevant to your change.
5. Do not overwrite teammates' in-progress work.

## 7) Commit, push, and open a pull request

```powershell
git add .
git commit -m "feat: short description"
git push -u origin feature/<your-scope>
```

Then open a pull request to `main` in GitHub.

## 8) Pull latest changes and resolve conflicts safely

```powershell
git checkout main
git pull origin main
git checkout feature/<your-scope>
git merge main
```

If conflicts appear:
1. Resolve conflicts in files carefully.
2. Re-run relevant tests.
3. Commit the merge resolution.

## 9) Keep secrets and private audio out of Git

- Never commit `.env` files with real credentials.
- Never commit private recordings, transcripts containing sensitive content, or local databases.
- Use `.env.example` for documented variable names only.

## 10) Report setup issues and document what changed

When blocked:
1. Share the exact command + error output in team chat/issue.
2. Document setup/workflow changes in docs via PR.
3. Keep onboarding docs current for the next teammate.
