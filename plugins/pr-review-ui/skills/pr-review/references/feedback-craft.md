# Feedback craft: how a senior engineer writes review comments that teach

The goal of a review is a better codebase **and** a better engineer. A comment that just hands over the fix improves the code once. A comment that makes the author see the principle improves every PR they write after this one. That is why this skill shows rather than solves.

## Anatomy of a finding

Every finding has these parts, in this order:

1. **Label + decoration** ([Conventional Comments](https://conventionalcomments.org/)):
   `issue (blocking, security):`, `suggestion (non-blocking):`, `question:`, `nitpick:`, `praise:`
2. **Observation.** What the code does, stated as a fact about the code, never about the person.
   - ✅ "This query is built by interpolating `discount_code` into the SQL string."
   - ❌ "You forgot to sanitize the input."
3. **Why it matters.** The concrete consequence *in this codebase*: a failure scenario (inputs → outcome), a cost (the next change takes 5 files), or a risk (a 3am page). If you can't write this, the finding is probably not worth raising.
4. **Principle.** The name of the idea, plus one line on what it says. This is the transferable lesson. Examples: "Parameterized queries / never mix code and data (OWASP A03)", "Fail fast", "Single Responsibility".
5. **Guiding question.** A question whose honest answer leads the author to the problem. It is a real question, not a disguised order.
6. **Hint ladder.** Hints are revealed progressively, only on request:
   - **Hint 1, nudge.** Where to look and what to think about. ("Look at how the value reaches `execute()`. What does the DB driver offer for passing values separately?")
   - **Hint 2, direction.** Name the technique or pattern and the API it lives in. ("sqlite3's `execute(sql, params)` with `?` placeholders.")
   - **Hint 3, sketch.** A minimal example on *toy code that is not theirs*, or a skeleton of their code with `___` blanks. Never the complete drop-in fix.
7. **Learn more** (optional). One high-quality link or search term (refactoring.guru page, OWASP cheat sheet, language docs).

Only when the user explicitly asks ("just show me the fix", "fix B1") does the full solution appear. Even then, explain each changed line.

## Severity ladder

Use the severity that matches the consequence, not your enthusiasm. If everything is blocking, nothing is.

| Severity | Netlify ladder | Meaning | Typical content |
|---|---|---|---|
| 🔴 **blocking** | ⛰ mountain / 🧗 boulder | Must change before merge | Bugs with a concrete failure scenario, security holes, data loss, broken public contracts, failing or deleted tests |
| 🟠 **important** | ⚪ pebble | Should change; may merge with an agreed follow-up | Design problems that will compound, missing tests for new behavior, silent error handling, notable performance risk at real scale |
| 🔵 **suggestion** | ⏳ sand | Would make it better; author's call | Simpler structure, better names, small refactors, clearer tests |
| ⚪ **nit** | 🌫 dust | Trivial polish, take it or leave it | Typos, tiny naming tweaks, ordering. **Max 3 per review**; batch the rest as "a few more nits of the same kind". Never nit what a formatter or linter would catch: suggest the tool instead |
| 💬 **question** | n/a | You need information to judge | Unclear intent, possible bug you couldn't confirm, missing context. Ask genuinely: "Is there a reason…? I may be missing context." |
| 🌟 **praise** | n/a | Specific, sincere, principle-linked | "The `Money` value object removes a whole class of rounding bugs. Nice use of Replace Primitive with Object." |

## Verdict

- 🟢 **Approve.** Nothing blocking or important; remaining items are optional.
- 🟡 **Approve with suggestions.** No blockers; one or more important or suggestion items the author should consider.
- 🔴 **Request changes.** At least one blocking finding.
- 💬 **Needs discussion.** The direction itself is in question (design or scope), or critical context is missing. Talk before more code is written.

## Phrasing patterns that teach

| Intent | Pattern |
|---|---|
| Edge case | "What happens if `items` is empty / `user` is `None` / two requests arrive at once?" |
| Error handling | "How would a caller know this failed?" |
| Coupling / OCP | "If we needed a second payment provider, which files would change?" |
| SRP | "Can you describe this function in one sentence without 'and'?" |
| Test strength | "If `calculate()` returned 0, would any test fail?" |
| Readability | "I found this hard to follow because… What if the name said *why*?" (own the reaction with "I") |
| Context | "Is there a reason for X? I might be missing context." |
| Consistency | "We do this with `retry_with_backoff()` in `utils/net.py`. Is there a reason not to reuse it?" |

## Rules of thumb

- **Code, not coder.** No "you", no "just", no "obviously", no "simply". Use "this function", "this line", "we".
- **Firm on principle, flexible on practice.** Be clear that the injection must go; be open about how they fix it.
- **A blocking question is still blocking.** Don't hide a mandatory change behind a soft question. Say `(blocking)` and still ask the question, so the author reasons it through.
- **Don't Socratic-ize trivia.** A typo gets a direct one-line nit, not a riddle.
- **Collapse patterns.** If the same issue appears 4 times, write one finding: "pattern: … (also at a.py:12, b.py:40, c.py:7)". Fix the habit, not each instance.
- **2–3 deep teaching moments per review.** Pick the principles with the highest leverage for this author. More than that is noise; the rest can be brief.
- **Limit examples.** At most 2–3 code sketches per review, and only in hint 3.
- **Scope.** Comment on what this PR changed or broke. A pre-existing problem is worth at most one `note:`, clearly marked as out of scope.
- **Praise for real.** At least one specific strength, tied to a principle. Generic "LGTM, nice work" teaches nothing.
- **Aim for a grade or two better, not perfect.** Approve when what's left is truly optional, and say it's optional.

## Do NOT flag (false-positive filter)

- Pre-existing issues on lines this PR did not touch (unless the PR makes them worse or newly reachable).
- Anything a configured linter, formatter or type checker will catch. Recommend the tool instead.
- Pedantic nitpicks a senior engineer wouldn't raise.
- Style preferences that contradict the repo's own conventions or CLAUDE.md. **House rules win over your taste.**
- Intentional behavior changes that are the point of the PR.
- "Possible" bugs with no concrete failure scenario. Make them questions, or drop them.
- Generic advice ("consider adding more tests") with no specific missing case named.
- Code explicitly suppressed with a justified ignore comment. Do flag *unjustified* new suppressions.

## Example: one finding, done well

> 🔴 **B1 · issue (blocking, security): SQL is built from the discount code** · `app/orders.py:11`
>
> **What I see:** `discount_code` is interpolated straight into the SQL string passed to `conn.execute()`.
>
> **Why it matters:** `discount_code` comes from the checkout form. A code of `x' OR '1'='1` matches every row, and a crafted one can read other tables. An attacker can give themselves any discount.
>
> **Principle:** *Never mix code and data.* Queries and values travel separately so input can never become SQL (OWASP A03: Injection).
>
> **Think about:** At the moment `execute()` runs, can the database tell which part of the string you wrote and which part the user typed?
>
> 💡 Hints: 3 levels available (`hint B1`)

And on request:

> **Hint 1:** The database driver can receive the SQL text and the values as two separate arguments. Look at `execute()`'s signature.
> **Hint 2:** The pattern is *parameterized queries*: placeholders (`?` in sqlite3) in the SQL, values passed as a tuple.
> **Hint 3:** On toy code: `cur.execute("SELECT name FROM pets WHERE species = ?", (species,))`. Now map that onto line 11. Which part becomes the `?`, and what goes in the tuple?
