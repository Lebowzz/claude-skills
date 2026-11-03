#!/usr/bin/env python3
"""Collect everything a reviewer needs to start a PR review, in one pass.

Prints a markdown briefing: what is being reviewed, the author's stated intent,
a file table (classified source/test/config/...), heuristic "leads" worth a
closer look, the project's convention files, and the diff annotated with
new-file line numbers so findings can cite exact `path:line` locations.

Usage (run from inside the repository):
  python pr_context.py                 # current branch vs. detected base (falls back to uncommitted work)
  python pr_context.py 123             # GitHub PR #123 (needs `gh`); also accepts #123 or a PR URL
  python pr_context.py --base develop  # current branch vs. develop
  python pr_context.py main..feature   # any git range
  python pr_context.py --staged        # staged changes only
  python pr_context.py --working       # all uncommitted changes vs. HEAD
  python pr_context.py --no-diff       # briefing only (for big PRs; then page with --files)
  python pr_context.py --files a.py b.py   # diff for selected files only

Leads are heuristics, not findings: every one must be verified by reading the code.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# --------------------------------------------------------------------------- shell


def run(args: list[str], check: bool = True) -> str:
    proc = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and proc.returncode != 0:
        raise RuntimeError(f"{' '.join(args)} failed: {proc.stderr.strip() or proc.stdout.strip()}")
    return proc.stdout


def git(*args: str, check: bool = True) -> str:
    return run(["git", *args], check=check)


def ok(*args: str) -> bool:
    return subprocess.run(["git", *args], capture_output=True).returncode == 0


# --------------------------------------------------------------------------- diff model


@dataclass
class Line:
    kind: str  # "+", "-", " "
    text: str
    new_no: int | None
    old_no: int | None


@dataclass
class Hunk:
    header: str
    lines: list[Line] = field(default_factory=list)


@dataclass
class FileDiff:
    path: str
    old_path: str | None = None
    status: str = "modified"  # added | deleted | renamed | modified | binary
    hunks: list[Hunk] = field(default_factory=list)
    added: int = 0
    removed: int = 0
    kind: str = "source"


HUNK_RE = re.compile(r"^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$")


def parse_diff(text: str) -> list[FileDiff]:
    files: list[FileDiff] = []
    cur: FileDiff | None = None
    hunk: Hunk | None = None
    old_no = new_no = 0
    for raw in text.splitlines():
        if raw.startswith("diff --git "):
            m = re.match(r'^diff --git "?a/(.+?)"? "?b/(.+?)"?$', raw)
            path = m.group(2) if m else raw.split(" b/")[-1]
            cur = FileDiff(path=path)
            files.append(cur)
            hunk = None
            continue
        if cur is None:
            continue
        if hunk is None or not raw or raw[0] not in "+- \\":
            if raw.startswith("new file mode"):
                cur.status = "added"
            elif raw.startswith("deleted file mode"):
                cur.status = "deleted"
            elif raw.startswith("rename from "):
                cur.status, cur.old_path = "renamed", raw[len("rename from "):]
            elif raw.startswith("rename to "):
                cur.path = raw[len("rename to "):]
            elif raw.startswith("Binary files"):
                cur.status = "binary"
        m = HUNK_RE.match(raw)
        if m:
            old_no, new_no = int(m.group(1)), int(m.group(2))
            hunk = Hunk(header=raw)
            cur.hunks.append(hunk)
            continue
        if hunk is None:  # file header lines (index, ---/+++ paths, modes)
            continue
        # Inside a hunk every +/- line is content, even "--- x" (a removed SQL comment).
        if raw.startswith("+"):
            hunk.lines.append(Line("+", raw[1:], new_no, None))
            new_no += 1
            cur.added += 1
        elif raw.startswith("-"):
            hunk.lines.append(Line("-", raw[1:], None, old_no))
            old_no += 1
            cur.removed += 1
        elif raw.startswith(" ") or raw == "":
            hunk.lines.append(Line(" ", raw[1:], new_no, old_no))
            new_no += 1
            old_no += 1
        # "\ No newline at end of file" is skipped
    for f in files:
        f.kind = classify(f.path)
    return files


# --------------------------------------------------------------------------- classification

LOCKFILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "cargo.lock", "go.sum",
    "gemfile.lock", "composer.lock", "uv.lock", "pipfile.lock", "packages.lock.json", "bun.lockb",
    "mix.lock", "pubspec.lock", "podfile.lock", "flake.lock",
}
MANIFESTS = {
    "package.json", "pyproject.toml", "requirements.txt", "cargo.toml", "go.mod", "gemfile",
    "composer.json", "pom.xml", "build.gradle", "build.gradle.kts", "setup.py", "setup.cfg",
    "pipfile", "pubspec.yaml", "mix.exs", "directory.packages.props",
}
CODE_EXT = {
    ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".go", ".rs", ".java", ".kt", ".kts",
    ".scala", ".rb", ".php", ".cs", ".fs", ".vb", ".c", ".h", ".cc", ".cpp", ".hpp", ".m", ".mm",
    ".swift", ".dart", ".ex", ".exs", ".erl", ".clj", ".lua", ".pl", ".r", ".jl", ".sh", ".bash",
    ".ps1", ".sql", ".vue", ".svelte", ".elm", ".hs", ".ml", ".zig", ".nim", ".tf", ".sol",
}


def classify(path: str) -> str:
    p = path.replace("\\", "/").lower()
    name = p.rsplit("/", 1)[-1]
    if name in LOCKFILES:
        return "lockfile"
    if re.search(r"(^|/)(dist|build|out|vendor|node_modules|third_party|__generated__|generated)/", p) or re.search(
        r"(\.min\.(js|css)$|_pb2(_grpc)?\.py$|\.pb\.go$|\.generated\.|\.g\.dart$|\.snap$|\.designer\.cs$)", p
    ):
        return "generated"
    if re.search(r"(^|/)(migrations?|alembic/versions|db/migrate)/", p):
        return "migration"
    if re.search(r"(^|/)(tests?|__tests__|spec|specs|testing)/", p) or re.search(
        r"(^test_.*|_test\.\w+$|\.test\.\w+$|\.spec\.\w+$|tests?\.\w+$|Tests?\.\w+$)", name
    ):
        return "test"
    if name in MANIFESTS:
        return "dependencies"
    if p.startswith(".github/") or name in {"dockerfile", "makefile", "jenkinsfile", ".gitlab-ci.yml"} or re.search(
        r"\.(ya?ml|toml|ini|cfg|conf|json|env\.example|properties|xml|plist|lock)$", name
    ):
        return "config"
    if re.search(r"\.(md|rst|txt|adoc)$", name) or p.startswith("docs/"):
        return "docs"
    if Path(name).suffix in CODE_EXT:
        return "source"
    return "other"


# --------------------------------------------------------------------------- leads (heuristics)

SENSITIVE_PATH = re.compile(
    r"auth|login|passw|token|secret|crypt|permission|acl|rbac|payment|billing|invoice|session|oauth|jwt|"
    r"sanitiz|security|admin|upload|webhook|migration|schema",
    re.I,
)

# (name, regex, applies-to kinds, why it is worth a look)
LEAD_RULES: list[tuple[str, re.Pattern[str], set[str], str]] = [
    ("possible secret", re.compile(
        r"(AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|"
        r"sk-[A-Za-z0-9]{20,}|(api[_-]?key|secret|passw(or)?d|token)\s*[:=]\s*['\"][^'\"\s]{8,}['\"])", re.I),
        {"source", "config", "test", "other", "docs"}, "credentials must never be committed"),
    ("debug leftover", re.compile(
        r"(\bconsole\.(log|debug)\(|\bdebugger;|\bpdb\.set_trace\(|\bbreakpoint\(\)|\bbinding\.pry|\bdbg!\(|"
        r"System\.out\.println|\bvar_dump\(|\bdd\()"), {"source"}, "stray debugging output in shipped code"),
    ("swallowed error", re.compile(
        r"(except\s*:\s*$|except\s+(Exception|BaseException)\s*(as\s+\w+)?\s*:\s*(pass)?\s*$|"
        r"catch\s*(\([^)]*\))?\s*\{\s*\}|\bon error resume next\b|_ = err\b|rescue\s*=>\s*\w+\s*$|catch\s*\{\s*\})", re.I),
        {"source"}, "broad or empty error handling hides failures"),
    ("suppressed check", re.compile(
        r"(#\s*type:\s*ignore|@ts-ignore|@ts-nocheck|as any\b|eslint-disable|#\s*noqa|//\s*nolint|"
        r"@SuppressWarnings|#\s*pylint:\s*disable|#\[allow\()"), {"source", "test"},
        "a tool's warning was silenced instead of addressed: ask why"),
    ("skipped test", re.compile(
        r"(@pytest\.mark\.skip|@unittest\.skip|\b(it|describe|test)\.skip\(|\bxit\(|\bxdescribe\(|@Ignore\b|@Disabled\b|t\.Skip\()"),
        {"test"}, "a disabled test is a lost safety net"),
    ("dynamic code / shell", re.compile(
        r"(\beval\(|\bexec\(|shell\s*=\s*True|os\.system\(|child_process\.exec\(|Runtime\.getRuntime\(\)\.exec|"
        r"new Function\(|pickle\.loads?\(|yaml\.load\((?!.*Loader))"), {"source"},
        "injection / remote-code-execution risk if any input is untrusted"),
    ("string-built SQL", re.compile(
        r"""(f["'].*\b(SELECT|INSERT|UPDATE|DELETE)\b.*\{|["']\s*\b(SELECT|INSERT|UPDATE|DELETE)\b[^"']*["']\s*(\+|%|\.format\()|"""
        r"""`\s*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{)""", re.I), {"source"}, "SQL injection unless every piece is trusted"),
    ("unsafe HTML", re.compile(r"(\.innerHTML\s*=|dangerouslySetInnerHTML|\bv-html\b|\|\s*safe\b|mark_safe\(|html_safe)"),
        {"source"}, "XSS if any part is user-controlled"),
    ("TLS / crypto weakening", re.compile(
        r"(verify\s*=\s*False|rejectUnauthorized\s*:\s*false|InsecureSkipVerify\s*:\s*true|\bmd5\b|\bsha1\b|"
        r"Math\.random\(\).*(token|id|secret|key)|random\.random\(\).*(token|secret|key))", re.I), {"source", "config"},
        "weak crypto or disabled certificate checks"),
    ("TODO added", re.compile(r"\b(TODO|FIXME|HACK|XXX)\b"), {"source", "test"},
        "deferred work: is there a ticket, or should it be done now?"),
    ("magic sleep", re.compile(r"(time\.sleep\(|Thread\.sleep\(|setTimeout\([^,]+,\s*\d{3,}\)|await\s+sleep\(|\bsleep\s+\d)"),
        {"source", "test"}, "sleeps often paper over races or make tests flaky"),
]

CONVENTION_FILES = [
    "CLAUDE.md", "AGENTS.md", ".claude/CLAUDE.md", "CONTRIBUTING.md", "docs/CONTRIBUTING.md", ".github/CONTRIBUTING.md",
    "STYLEGUIDE.md", "ARCHITECTURE.md", "docs/architecture.md", ".github/pull_request_template.md", ".editorconfig",
    "pyproject.toml", "setup.cfg", ".flake8", "ruff.toml", ".pylintrc", "mypy.ini", "tsconfig.json", ".eslintrc",
    ".eslintrc.js", ".eslintrc.json", ".eslintrc.cjs", "eslint.config.js", "eslint.config.mjs", "biome.json",
    ".prettierrc", ".golangci.yml", ".golangci.yaml", ".rubocop.yml", "rustfmt.toml", "clippy.toml",
    ".clang-format", ".clang-tidy", "checkstyle.xml", ".scalafmt.conf", "detekt.yml", ".swiftlint.yml",
    "Directory.Build.props", ".stylelintrc",
]


@dataclass
class Lead:
    rule: str
    path: str
    line: int
    text: str
    why: str


def find_leads(files: list[FileDiff]) -> list[Lead]:
    leads: list[Lead] = []
    for f in files:
        if f.kind in {"lockfile", "generated"}:
            continue
        for h in f.hunks:
            for ln in h.lines:
                if ln.kind != "+":
                    continue
                for name, rx, kinds, why in LEAD_RULES:
                    if f.kind in kinds and rx.search(ln.text):
                        leads.append(Lead(name, f.path, ln.new_no or 0, ln.text.strip()[:140], why))
    return leads


# --------------------------------------------------------------------------- target resolution


@dataclass
class Target:
    label: str
    diff: str
    intent_title: str = ""
    intent_body: str = ""
    commits: list[str] = field(default_factory=list)
    meta: dict = field(default_factory=dict)
    untracked: list[str] = field(default_factory=list)


DIFF_FLAGS = ["--no-color", "--no-ext-diff", "-M", "--unified=3"]


def detect_base() -> str | None:
    head = git("rev-parse", "--abbrev-ref", "origin/HEAD", check=False).strip()
    candidates = [head] if head and head != "origin/HEAD" else []
    candidates += ["origin/main", "origin/master", "origin/develop", "main", "master", "develop", "trunk"]
    current = git("rev-parse", "--abbrev-ref", "HEAD", check=False).strip()
    for c in candidates:
        if c and c != current and ok("rev-parse", "--verify", "--quiet", c):
            return c
    return None


def pr_target(ref: str) -> Target:
    meta = json.loads(run([
        "gh", "pr", "view", ref, "--json",
        "number,title,body,author,baseRefName,headRefName,url,isDraft,labels,commits,reviewDecision,additions,deletions,changedFiles",
    ]))
    diff = run(["gh", "pr", "diff", ref, "--color=never"])
    commits = [f"{c.get('oid', '')[:8]} {c.get('messageHeadline', '')}" for c in meta.get("commits", [])]
    label = f"PR #{meta['number']} · {meta['headRefName']} → {meta['baseRefName']} · by @{meta.get('author', {}).get('login', '?')}"
    if meta.get("isDraft"):
        label += " · DRAFT"
    return Target(label, diff, meta.get("title", ""), meta.get("body") or "", commits, meta)


def range_target(base: str, head: str = "HEAD") -> Target:
    diff = git("diff", *DIFF_FLAGS, f"{base}...{head}")
    commits = git("log", "--no-merges", "--format=%h %s", f"{base}..{head}", check=False).splitlines()
    # Commit bodies only (subjects are already in `commits`); skip empty ones.
    raw = git("log", "--no-merges", "--format=%h%x00%b%x1e", f"{base}..{head}", check=False)
    entries = (c.strip().partition(chr(0)) for c in raw.split(chr(30)))
    bodies = (chr(10) * 2).join(f"[{h}] {b.strip()}" for h, _, b in entries if b.strip())
    title = commits[0].split(" ", 1)[1] if len(commits) == 1 and " " in commits[0] else ""
    return Target(f"{head} vs {base} ({len(commits)} commit(s))", diff, title, bodies, commits)


def working_target(staged_only: bool) -> Target:
    if staged_only:
        return Target("staged changes", git("diff", "--cached", *DIFF_FLAGS))
    untracked = [u for u in git("ls-files", "--others", "--exclude-standard").splitlines() if u]
    has_head = ok("rev-parse", "--verify", "--quiet", "HEAD")
    diff = git("diff", *DIFF_FLAGS, "HEAD") if has_head else git("diff", "--cached", *DIFF_FLAGS)
    return Target("uncommitted changes vs HEAD", diff, untracked=untracked)


def resolve(args: argparse.Namespace) -> Target:
    t = args.target
    if args.staged:
        return working_target(True)
    if args.working:
        return working_target(False)
    if t and re.fullmatch(r"#?\d+|https?://\S+/pull/\d+\S*", t):
        return pr_target(t.lstrip("#"))
    if t and ".." in t:
        base, head = t.split("...", 1) if "..." in t else t.split("..", 1)
        return range_target(base, head or "HEAD")
    if t:  # a branch name: review it against the base
        base = args.base or detect_base()
        if not base:
            raise RuntimeError("could not detect a base branch; pass --base")
        return range_target(base, t)
    base = args.base or detect_base()
    if base:
        tgt = range_target(base)
        if tgt.diff.strip():
            if git("status", "--porcelain").strip():
                tgt.label += " · NOTE: uncommitted changes exist and are NOT included (use --working)"
            return tgt
    return working_target(False)


# --------------------------------------------------------------------------- output


def annotated(f: FileDiff, max_lines: int) -> tuple[list[str], int]:
    out: list[str] = []
    for h in f.hunks:
        out.append(h.header)
        for ln in h.lines:
            if ln.kind == "+":
                out.append(f"{ln.new_no:>5} + {ln.text}")
            elif ln.kind == "-":
                out.append(f"{'':>5} - {ln.text}")
            else:
                out.append(f"{ln.new_no:>5}   {ln.text}")
    if len(out) > max_lines:
        return out[:max_lines] + [f"  … {len(out) - max_lines} more diff lines in this file (use --files {f.path})"], len(out)
    return out, len(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", nargs="?", help="PR number/URL, branch, or git range (a..b)")
    ap.add_argument("--base", help="base branch to compare against")
    ap.add_argument("--staged", action="store_true")
    ap.add_argument("--working", action="store_true")
    ap.add_argument("--no-diff", action="store_true", help="omit the annotated diff")
    ap.add_argument("--files", nargs="+", help="only show the diff for these paths (substring match)")
    ap.add_argument("--max-diff-lines", type=int, default=2500, help="total diff lines to print (default 2500)")
    ap.add_argument("--per-file-lines", type=int, default=600, help="max diff lines per file (default 600)")
    args = ap.parse_args()

    if not ok("rev-parse", "--is-inside-work-tree") and not (args.target and re.search(r"\d", args.target)):
        print("Not inside a git repository. Pass a PR number (with `gh`) or run from the repo.", file=sys.stderr)
        return 2
    try:
        tgt = resolve(args)
    except (RuntimeError, FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"Could not resolve the review target: {exc}", file=sys.stderr)
        return 2

    files = parse_diff(tgt.diff)
    if not files and not tgt.untracked:
        print(f"# Review target: {tgt.label}\n\nNo changes found. Nothing to review.")
        return 0

    reviewable = [f for f in files if f.kind not in {"lockfile", "generated"}]
    added = sum(f.added for f in reviewable)
    removed = sum(f.removed for f in reviewable)
    kinds = {f.kind for f in files}

    p = print
    p(f"# Review target: {tgt.label}")
    if tgt.meta.get("url"):
        p(f"URL: {tgt.meta['url']}")
    p(f"\n**Size:** {len(files)} files · +{added} −{removed} reviewable lines"
      + (f" · {len(files) - len(reviewable)} lockfile/generated file(s) excluded from counts" if len(files) != len(reviewable) else ""))

    p("\n## Stated intent")
    if tgt.intent_title:
        p(f"**Title:** {tgt.intent_title}")
    body = tgt.intent_body.strip()
    p(body[:4000] + ("\n…(truncated)" if len(body) > 4000 else "") if body else "_No description. Infer intent from the code and commits, and note the missing description._")
    if tgt.commits:
        p("\n**Commits:**")
        for c in tgt.commits[:40]:
            p(f"- {c}")
        if len(tgt.commits) > 40:
            p(f"- … {len(tgt.commits) - 40} more")

    p("\n## Files")
    p("| status | + | − | kind | path |\n|---|---:|---:|---|---|")
    order = {"source": 0, "migration": 1, "dependencies": 2, "config": 3, "test": 4, "docs": 5, "other": 6, "generated": 7, "lockfile": 8}
    for f in sorted(files, key=lambda f: (order.get(f.kind, 9), f.path)):
        path = f"{f.old_path} → {f.path}" if f.old_path else f.path
        p(f"| {f.status} | {f.added} | {f.removed} | {f.kind} | `{path}` |")
    for u in tgt.untracked:
        p(f"| untracked | ? | 0 | {classify(u)} | `{u}` (not in diff: read it directly) |")

    # ---- signals
    p("\n## Signals (heuristic leads: verify each before turning it into a finding)")
    signals: list[str] = []
    if added + removed > 400:
        signals.append(f"**Large change** ({added + removed} lines). Review quality drops past ~400 lines; consider whether it should be split, and say so if it's not cohesive.")
    src_changed = any(f.kind == "source" and f.added > 0 for f in files)
    if src_changed and "test" not in kinds:
        signals.append("**Source changed but no test files changed.** Check whether behaviour changes are covered by existing tests, or whether tests are missing.")
    if "migration" in kinds:
        signals.append("**Database migration present.** Check reversibility, locking on large tables, backfill strategy, and deploy ordering with the code.")
    if "dependencies" in kinds:
        signals.append("**Dependency manifest changed.** Check each new dependency is needed, maintained, licensed acceptably, and pinned as the project does.")
    if "lockfile" in kinds and "dependencies" not in kinds:
        signals.append("**Lockfile changed without a manifest change.** Unexpected: ask why.")
    sens = sorted({f.path for f in reviewable if SENSITIVE_PATH.search(f.path)})
    if sens:
        signals.append("**Security-sensitive areas touched:** " + ", ".join(f"`{s}`" for s in sens[:12]))
    deleted_src = [f.path for f in files if f.status == "deleted" and f.kind == "source"]
    if deleted_src:
        signals.append("**Source files deleted:** check for remaining references: " + ", ".join(f"`{d}`" for d in deleted_src[:10]))
    for s in signals:
        p(f"- {s}")
    leads = find_leads(files)
    if leads:
        p("\n**Line-level leads:**")
        for ld in leads[:60]:
            p(f"- `{ld.path}:{ld.line}` [{ld.rule}] `{ld.text}`: {ld.why}")
        if len(leads) > 60:
            p(f"- … {len(leads) - 60} more")
    if not signals and not leads:
        p("- none")

    # ---- conventions
    root = Path(git("rev-parse", "--show-toplevel", check=False).strip() or ".")
    present = [c for c in CONVENTION_FILES if (root / c).is_file()]
    p("\n## House rules to read before judging style")
    p(", ".join(f"`{c}`" for c in present) if present else "_None found at the repo root: infer conventions from neighbouring code._")

    # ---- diff
    if args.no_diff:
        p("\n_Diff omitted (--no-diff). Page through it with `--files <path> ...`._")
        return 0
    p("\n## Annotated diff")
    p("_Format: `<new line no> <+|-| > <code>`. Cite findings as `path:<new line no>`. Removed lines have no new number._")
    budget = args.max_diff_lines
    skipped: list[str] = []
    for f in sorted(files, key=lambda f: (order.get(f.kind, 9), f.path)):
        if args.files and not any(s in f.path for s in args.files):
            continue
        if f.kind in {"lockfile", "generated"} and not args.files:
            skipped.append(f.path)
            continue
        if budget <= 0:
            skipped.append(f.path)
            continue
        lines, _ = annotated(f, min(args.per_file_lines, budget))
        budget -= len(lines)
        p(f"\n### `{f.path}`  ({f.status}, {f.kind}, +{f.added} −{f.removed})")
        if f.status == "binary":
            p("_binary file_")
            continue
        p("```diff")
        for ln in lines:
            p(ln)
        p("```")
    if skipped:
        p("\n_Not shown (lockfile/generated or over budget): " + ", ".join(f"`{s}`" for s in skipped) + ". Use `--files` to view._")
    return 0


if __name__ == "__main__":
    sys.exit(main())
