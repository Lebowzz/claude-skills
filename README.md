# claude-skills

Claude Code skills and mods.

## pr-review-ui

A pull request review that works like a senior engineer who **teaches rather than fixes**. It checks design (SOLID, cohesion and coupling), correctness, error handling, security, tests, simplicity, naming, performance, concurrency and API compatibility. Every finding is verified, ideally by running the code, before it is reported. Each one explains the principle behind it and asks a guiding question, and three progressive hints stay hidden until you ask for them.

The plugin bundles:
- **`pr-review` skill**: the review workflow (scope → intent and house rules → priority-ordered review → verification → report), a context script that collects a line-numbered diff and flags risky patterns, and reference guides on principles, writing feedback that teaches, and language pitfalls.
- **Terminal UI**: nothing shows until the skill runs. Then you get a live progress band, a review card in the transcript, and a findings panel (`/pr-review-panel`) where you reveal hints one at a time and mark findings as understood.

### Install

At the prompt of a Claude Code terminal session:

```
/plugin install pr-review-ui --marketplace Lebowzz/claude-skills
```

Answer `y` to add the marketplace, then pick a scope (user scope is the first choice).

From a shell:

```
claude plugin install pr-review-ui --marketplace Lebowzz/claude-skills
```

In the desktop app, where `/plugin` doesn't run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Lebowzz/claude-skills`, then **Add plugin**.

This repository is private. Installing needs read access on GitHub plus a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`).

### Use

Ask Claude something like "review my PR", "review #123" or "look over this branch before I merge". After the review:
- `hint B1` reveals the next hint
- `explain B1` gives a deeper walkthrough
- `fix B1` shows the full solution, only when you ask
- `post` drafts GitHub review comments and posts only after you confirm

Requirements: `git`, Python 3.9+ for the context script, and `gh` for reviewing GitHub PRs by number.
