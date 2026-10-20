# CLAUDE.md

## Daily report pipeline — standing authorizations

This repo's daily-report data pipeline runs on branch `claude/zip-component-analysis-0jm9or`
(see `assets/data/reports/` + `scripts/`). The user has given **standing authorization**
for the following action, so it does not need to be asked for each time:

- **After committing and pushing a new day's report data to `claude/zip-component-analysis-0jm9or`
  (whether from a user-uploaded PDF in chat, or from the automated daily OneDrive-check routine),
  merge that branch into `main` and push `main`.** This is what keeps the production Vercel
  deployment (`dailyreport-x15l` project) showing the latest data. Use a `--no-ff` merge commit,
  push, then switch back to the daily branch so it stays the working branch. If the merge ever
  hits a real conflict (shouldn't happen in normal operation — `main` should only ever receive
  fast-forward-able content from the daily branch), stop and flag it to the user rather than
  resolving it unilaterally.

- This authorization covers only merging the daily-report branch into `main`. Any other
  destructive or production-affecting action still needs the user's explicit go-ahead.
