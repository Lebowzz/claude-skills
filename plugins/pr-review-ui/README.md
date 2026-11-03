# pr-review-ui

The visual layer for the `pr-review` skill. It draws nothing until that skill runs. Then it adds:

- **A live progress band** above the prompt: `◆ PR Review ✔ Scope ─ ✔ Intent ─ ● Review ─ ○ Verify ─ ○ Report`.
- **A review card** in the transcript: verdict badge, area scorecard, findings grouped by severity with the principle each one violates, strengths, and the learning focus.
- **An interactive findings panel.** Pick a finding to see the code, what's wrong, why it matters, the principle and a guiding question. Hints are revealed one at a time, so the author can work it out before seeing the answer. Findings can be marked as understood, and "Ask Claude to explain" pre-fills `explain <id>` in the prompt.

Open the panel at any time with `/pr-review-panel`. In the panel, Tab moves between controls; `h` reveals the next hint, `e` asks Claude to explain, and `u` marks the finding understood.

How it works: when the `pr-review` skill's prompt is expanded, the mod appends instructions telling Claude to use two tools it registers, `mcp__pr-review-ui__stage` (progress) and `mcp__pr-review-ui__publish` (the structured review). Without this mod, the skill falls back to a plain markdown report.

## Install

```
/plugin install pr-review-ui --marketplace Lebowzz/claude-skills
```
