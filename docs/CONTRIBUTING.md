# Contributing

## Branch model

- `main`: stable, reviewed, tested code.
- `feature/mcp-backend`
- `feature/web-ui`
- `feature/voice-agent`

Notes:
- Create these branches separately in Git/GitHub after repository creation.
- Base all feature work on the latest `main`.

## Branch naming

Use descriptive names:
- `feature/<scope>` for features
- `fix/<scope>` for bug fixes
- `docs/<scope>` for documentation-only work

## Commits

- Keep commits focused and small.
- Use clear messages, e.g. `feat: add speaker mapping ui stub`.
- Avoid mixing unrelated changes in one commit.

## Pull requests

- Open PRs from feature branch into `main`.
- Explain what changed, why, and what is still planned.
- Link related issue(s).
- Include screenshots/logs only when relevant.

## Reviews

- At least one teammate review before merge.
- Resolve review comments before merging.
- Re-run relevant checks after substantial updates.

## Merge rules

- Prefer squash merge for clean history unless team agrees otherwise.
- Merge only when review feedback is addressed and checks pass.
- Do not merge code that claims unimplemented functionality is complete.
