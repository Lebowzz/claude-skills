# Senior reviewer's principles catalog

Use this as a lens, not a checklist to recite. For each area: what a violation **looks like in a diff**, the **question** that exposes it, and the **name** to teach (a principle or named refactoring gives the author a search term to keep learning from).

Areas are ordered by review priority. A design problem makes line-level comments moot, so work top-down.

## Contents
1. Design & architecture (SOLID, cohesion/coupling)
2. Correctness
3. Error handling & failure modes
4. Security (OWASP-aligned)
5. Tests
6. Simplicity (KISS, YAGNI, DRY, rule of three)
7. Naming & readability
8. Performance
9. Concurrency & async
10. API design & backward compatibility
11. Data, schema & migrations
12. Observability & operability
13. Comments & documentation
14. Smell → refactoring table

---

## 1. Design & architecture
The most important pass. Ask: *does this change belong here, in this shape, now?*

| Principle | Looks like in a diff | Question that exposes it |
|---|---|---|
| **Single Responsibility (SRP)** | A function or class gains an unrelated job (`UserService` now also formats emails and writes CSV); a function needs "and" to describe it; one function both fetches, transforms and persists | "Can you describe this function in one sentence without 'and'?" |
| **Open/Closed (OCP)** | A new `elif type == ...` / `case` added to a switch on a type tag that also exists elsewhere | "If we add a fourth kind next month, how many places change?" |
| **Liskov Substitution (LSP)** | An override throws `NotImplementedError`, ignores a parameter, narrows accepted input, or returns a different shape | "Could every caller of the base type use this subclass unchanged?" |
| **Interface Segregation (ISP)** | An interface gains methods most implementers stub out | "Which implementers actually need this method?" |
| **Dependency Inversion (DIP)** | High-level logic constructs a concrete DB/HTTP/clock/random inline; tests need monkey-patching to substitute it | "How would you test this without a real database?" |
| **High cohesion / low coupling** | One file edited for unrelated reasons (*Divergent Change*); one concept forces edits across many files (*Shotgun Surgery*) | "What would change together, and is it in one place?" |
| **Law of Demeter** | `order.customer.address.city.name` chains (*Message Chains*); a method using another object's data more than its own (*Feature Envy*) | "Who should own this knowledge?" |
| **Separation of concerns / layering** | UI code issuing SQL; domain logic importing the web framework; I/O mixed into pure computation | "Could this logic run without the framework around it?" |
| **Consistency with the codebase** | A new pattern or library introduced where an established one exists (second HTTP client, second date library, a hand-rolled retry next to a shared one) | "Is there an existing way the codebase does this?" Search before you suggest. |

The healthiest design comment often asks whether the work belongs in a different module or should reuse an existing utility. Grep for one before you say so.

## 2. Correctness
| Smell | Looks like | Question |
|---|---|---|
| Edge cases | Empty collections, `None`/`null`, zero, negative, max values, unicode, timezones/DST, leap years, very large inputs | "What happens when `items` is empty?" |
| Off-by-one | `<` vs `<=`, slicing bounds, pagination offsets, inclusive/exclusive ranges | "Walk me through the last iteration." |
| Wrong assumption about a callee | Code assumes a function never returns null, sorts in place, or is idempotent; **read the callee to check** | "What does `x()` return when it fails?" |
| State/ordering | Mutating an argument the caller still uses; relying on dict/set order; stale cached values | "Who else holds a reference to this list?" |
| Numeric | Float for money; integer division; overflow; rounding mode | "What's `0.1 + 0.2` here?" |
| Contract drift | The name/docstring says one thing, the code now does another | "Does `get_user` still only get?" |
| Partial updates | Two writes that must both happen, not in a transaction | "What if the process dies between these lines?" |

Every correctness finding needs a **concrete failure scenario**: inputs or state → wrong output or crash. If you can't produce one, it's a question, not an issue.

## 3. Error handling & failure modes
Hunt silent failures; these are the bugs that page someone at 3am.
- Empty `catch`/`except: pass`, or catch-log-continue where the caller then proceeds on bad state.
- Overly broad catch (`except Exception`, `catch (Throwable)`). **List the unexpected errors it could hide** (KeyError, TypeError, network timeouts).
- Returning `null`/`-1`/`[]`/default on failure so the caller can't tell "empty" from "broken".
- Optional chaining or `?? default` that skips work which must happen.
- Re-throw that loses the cause or stack (`raise NewError()` without `from e`; `throw new Error(e.message)`).
- Retries with no backoff, no cap, no idempotency, or that give up silently.
- Resources not released on error paths (no `with` / `try-finally` / `defer` / `using`).
- User-facing messages leaking internals (stack traces, SQL, file paths).

Principle names: **Fail fast**, **Don't swallow errors**, **Make illegal states unrepresentable**.
Question: *"How would a caller, or an on-call engineer, know this failed?"*

## 4. Security
Check every place untrusted input crosses a boundary.
- **Injection (OWASP A03).** SQL, shell, LDAP, template or `eval` built from strings. Fix family: parameterization, argv arrays, allow-lists.
- **Broken access control (A01).** New endpoint or handler without an authz check; IDOR (an id from the request used without an ownership check); trusting client-sent role or price.
- **Secrets.** Hardcoded keys or passwords; secrets in logs, URLs or error messages; `.env` committed.
- **XSS.** `innerHTML`, `dangerouslySetInnerHTML`, `|safe`, unescaped template output.
- **Crypto failures (A02).** MD5/SHA1 for passwords; `Math.random`/`random.random` for tokens (use a CSPRNG); disabled TLS verification; homemade crypto.
- **Unsafe deserialization.** `pickle.loads`, `yaml.load` without SafeLoader, Java native deserialization of input.
- **SSRF.** Fetching a URL that came from input without an allow-list.
- **Path traversal.** Joining user input into file paths without normalizing and confining.
- **Config.** CORS `*` with credentials; debug mode on; permissive file permissions.
- **Dependencies.** New, unpinned or unmaintained packages; typosquat-looking names.
- **Data exposure.** PII in logs; over-broad API responses (returning the whole user row).

Ask *"What happens with malicious input?"* and walk one concrete payload through the code.

## 5. Tests
Google's test: **"Will the tests actually fail when the code is broken?"**
- New behavior or a fixed bug with no test. A bug fix should come with a test that fails before the fix.
- Tests that assert only on mocks or call counts, not on observable behavior.
- Tautological tests (expected value computed with the same logic as the code).
- Missing edge cases: empty, null, boundary, error path, concurrency.
- Flakiness: sleeps, wall-clock time, randomness, test order, shared global state, real network.
- Over-mocking, which couples tests to implementation and breaks on refactor.
- Snapshot-everything tests nobody reads.
- Deleted or skipped tests that make CI green.
- Test names that don't describe behavior (`test1`, `test_works`).
- Test code is code too: duplication and unreadable setup matter.

Principle names: **Test behavior, not implementation**, **Arrange-Act-Assert**, **one reason to fail**.
Question: *"If I changed `>` to `>=` on line N, which test would fail?"*

## 6. Simplicity
- **KISS.** Clever one-liners, nested ternaries, deep nesting (prefer guard clauses / early return), metaprogramming where a plain function works.
- **YAGNI / Speculative Generality.** Plugin registries, strategy interfaces or config flags with one implementation and no caller; parameters "for later".
- **DRY, with judgment.** Copy-paste-modify blocks are worth flagging at the **third** occurrence (rule of three). Also teach the reverse: a premature abstraction with boolean flags (`process(x, is_admin, skip_cache, legacy)`) is worse than duplication. Duplication is cheaper than the wrong abstraction.
- **Dead code.** Unused functions, params, imports, commented-out blocks.
- **Primitive Obsession.** Raw strings and ints standing in for domain concepts (money, email, ids, units).

Question: *"What's the simplest version that solves today's problem?"*

## 7. Naming & readability
- Vague names: `data`, `info`, `tmp`, `obj`, `handle`, `process`, `manager`, `util`, `doStuff`.
- Names that lie after the change (`getUser` now creates users; `isValid` that mutates).
- Booleans that aren't predicates (`flag`, `status`); prefer `is_`/`has_`/`should_`.
- Same concept, different words (`client`/`customer`/`account` for one thing).
- Magic numbers and strings; extract named constants that carry the *why*.
- Long functions (> ~40 lines is a prompt to look, not a rule), long parameter lists (> 3–4), *Data Clumps* (the same 3 params always travel together).
- Mixed abstraction levels in one function (business rule next to byte twiddling).

Question: *"Would someone new to this code understand it in six months without asking you?"*

## 8. Performance
Flag only what matters at realistic scale. Say what scale you're assuming.
- **N+1.** A DB or HTTP call inside a loop.
- O(n²) on collections that grow: nested loops, `list.index`/`in list` inside loops (use a set or dict).
- Unbounded work: `SELECT *` with no limit, loading a whole file or table into memory, unpaginated APIs.
- Missing index for a new query pattern (check the migration).
- Sync or blocking I/O on hot or async paths; work that could be hoisted out of a loop.
- Caches with no eviction or TTL (that's a memory leak); unbounded queues.
- Excess allocations in tight loops; string concatenation in loops in languages where it's quadratic.

Question: *"What happens when this table has 10 million rows?"*

## 9. Concurrency & async
- Shared mutable state with no lock; non-atomic read-modify-write (`count += 1` across threads or processes).
- Check-then-act races (`if not exists: create`). Use a unique constraint, upsert or atomic op.
- Missing `await`; fire-and-forget promises or tasks whose errors vanish.
- Blocking calls inside async code (`time.sleep`, sync HTTP in an event loop).
- Lock ordering that can deadlock; holding locks across I/O.
- Retried operations that aren't idempotent (double charge, double email).
- Goroutine, thread or timer leaks: started, never stopped or joined.

Question: *"What if two requests hit this at the same moment?"*

## 10. API design & backward compatibility
- Renamed or removed public fields, endpoints, CLI flags, env vars, events or exported functions.
- Changed defaults, error codes, enum values, response shapes, units or sort orders.
- New *required* parameter on an existing public signature.
- Same signature, different output: a function that now returns different values for inputs it already handled (slug or ID formats, rounding, normalization, ordering). Records, URLs and cache keys built with the old behavior stop matching.
- Inconsistent pagination, error shape or naming versus sibling endpoints.
- No deprecation path or versioning for a breaking change.
- Leaky abstraction: internal types or DB models exposed through the public API.

Principle: **Hyrum's Law**: every observable behavior will be depended on by someone.
Question: *"Who calls this today, and what breaks for them after deploy?"*

## 11. Data, schema & migrations
- Not backward compatible with the *currently running* code. For example, dropping or renaming a column in the same deploy that stops using it. Use expand → migrate → contract.
- Long locks on big tables (adding a non-null column with a default on old engines, building an index without `CONCURRENTLY`).
- No down migration or rollback plan; a destructive backfill with no dry run.
- Missing constraints the code relies on (unique, not-null, foreign key).
- Time stored without a timezone; money stored as float.

## 12. Observability & operability
- New failure path with no log, metric or trace; errors swallowed without a counter.
- Logs without context (request id, entity id) or at the wrong level (errors at `info`, noise at `error`).
- PII or secrets in logs.
- No way to tell in production whether the feature works; no feature flag or kill switch for risky rollouts.
- Timeouts missing on outbound calls.

Question: *"If this breaks at 3am, what will the on-call engineer see?"*

## 13. Comments & documentation
- Comments that restate *what* the code does instead of *why*.
- Stale comments the change made false (check comments near edited lines).
- Comments used as deodorant for unclear code: rename or extract instead.
- TODO/FIXME with no ticket or owner.
- README, API docs, changelog or config docs not updated for user-visible changes.
- If you needed the author to explain something, the fix is clearer code or a code comment, not a review-thread answer.

## 14. Smell → refactoring table
Naming the refactoring gives the author a precise thing to look up (refactoring.guru, Fowler's *Refactoring*).

| Smell | Named refactoring(s) |
|---|---|
| Long Method | Extract Function, Decompose Conditional, Replace Temp with Query |
| Large Class / God object | Extract Class, Extract Superclass/Interface |
| Long Parameter List / Data Clumps | Introduce Parameter Object, Preserve Whole Object |
| Primitive Obsession | Replace Primitive with Object (Value Object) |
| Switch on type tags | Replace Conditional with Polymorphism, Strategy, lookup table |
| Duplicate Code (3rd time) | Extract Function, Pull Up Method, Form Template Method |
| Feature Envy | Move Function |
| Message Chains | Hide Delegate |
| Shotgun Surgery | Move Function / Combine Functions into Class |
| Divergent Change | Split Phase, Extract Class |
| Speculative Generality | Collapse Hierarchy, Inline Function, Remove Dead Code |
| Deep nesting | Replace Nested Conditional with Guard Clauses |
| Flag arguments | Remove Flag Argument (split into explicit functions) |
| Mutable shared data | Encapsulate Variable, Change Reference to Value |
| Temporary Field | Extract Class, Introduce Special Case (Null Object) |
| Comments explaining confusing code | Extract Function with a good name, Introduce Assertion |
