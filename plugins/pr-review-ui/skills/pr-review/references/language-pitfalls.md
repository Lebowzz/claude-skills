# Language-specific pitfalls

Read only the section for the languages in the diff. These are traps a senior reviewer in that ecosystem spots on sight. Always check the repo's own conventions first; they override these.

## Contents
Python · JavaScript/TypeScript · React/frontend · Go · Java/Kotlin · C#/.NET · Rust · SQL · Shell · C/C++ · Ruby · PHP

## Python
- Mutable default arguments (`def f(x=[])`): the default is shared across calls.
- Bare `except:` / `except Exception: pass`; `raise X` inside `except` without `from e` loses the cause.
- Late-binding closures in loops (`lambda: i` captures the variable, not the value).
- `is` used for value comparison (`x is 1`, `s is "a"`); `== None` instead of `is None`.
- Files, locks or connections opened without `with`.
- `datetime.now()` / `utcnow()` with no timezone; naive and aware datetimes mixed.
- `float` used for money; prefer `Decimal` or integer cents.
- Blocking calls (`requests`, `time.sleep`) inside `async def`; un-awaited coroutines.
- `pickle` or `yaml.load` on untrusted data; `subprocess(..., shell=True)` with interpolated input.
- Imports with side effects; circular imports papered over by local imports.
- Type hints that lie (`-> User` that can return `None`: should be `Optional[User]`).
- `assert` used for runtime validation (stripped under `-O`).

## JavaScript / TypeScript
- `==` instead of `===`; truthiness bugs where `0`, `""` or `NaN` are valid values (`if (count)`, `x || default`: prefer `??`).
- Floating promises: an `async` call without `await`, `.catch`, or `void` marking intent. `forEach` with an async callback doesn't await anything.
- `any`, `as` casts and non-null `!` assertions silencing real type errors; `@ts-ignore` without justification.
- Mutating props, state or function arguments; shared module-level mutable state in servers.
- `JSON.parse` on input without validation (zod/io-ts or similar at the boundary).
- `Array.prototype.sort()` without a comparator sorts numbers as strings and mutates in place.
- Date handling via `new Date(string)` parsing (locale/timezone dependent).
- Unbounded `Promise.all` over user-sized arrays (no concurrency limit).
- In Node: sync fs/crypto in request paths; `child_process.exec` with interpolated input.
- Exported types widened (`string` where a union of literals is the real contract).

## React / frontend
- Missing or incorrect `useEffect` dependencies; effects without cleanup (subscriptions, timers).
- State derived from props copied into state (gets stale); prefer computing it during render.
- `key={index}` on reorderable lists.
- `dangerouslySetInnerHTML` or `v-html` with non-sanitized content.
- Expensive work in render without memoization, but also gratuitous `useMemo`/`useCallback` everywhere (noise).
- Accessibility: clickable `div`s without role or keyboard handling, images without `alt`, missing labels on inputs, color-only status.
- Secrets or API keys in client bundles.

## Go
- Ignored errors (`_ = f()`, or an unchecked `err`); errors wrapped without `%w`.
- Goroutine leaks: started with no cancellation via `context` or no way to exit; unbuffered channel sends nobody receives.
- Loop variable capture in goroutines (pre-Go 1.22 semantics).
- `defer` inside loops (resources held until the function returns).
- Data races on maps; maps are not safe for concurrent writes.
- `context.Context` not propagated or not the first parameter; `context.Background()` deep in request paths.
- Nil interface vs nil pointer inside an interface.
- HTTP clients without timeouts (`http.DefaultClient`); response bodies not closed.

## Java / Kotlin
- Catching `Exception`/`Throwable` broadly; empty catch blocks; checked exceptions wrapped and lost.
- `equals` overridden without `hashCode`; mutable objects used as map keys.
- Resources not in try-with-resources (`use {}` in Kotlin).
- `Optional.get()` without a check; `Optional` used for fields or parameters.
- Kotlin: `!!` to silence nullability; `lateinit` misuse; platform types from Java treated as non-null.
- Thread-unsafe singletons and lazy init; `SimpleDateFormat` shared across threads.
- JPA: N+1 via lazy relations in loops; `@Transactional` on private methods or self-invocation (no proxy, no transaction).
- Streams with side effects; parallel streams on shared state.

## C# / .NET
- `async void` (outside event handlers); `.Result` / `.Wait()` causing deadlocks; missing `ConfigureAwait` in libraries where the project uses it.
- `IDisposable` not disposed (`using`); `HttpClient` created per request (socket exhaustion; use `IHttpClientFactory`).
- Catching `Exception` and continuing; `throw ex;` instead of `throw;` (resets the stack trace).
- Nullable reference warnings suppressed with `!`.
- EF Core: queries in loops, `ToList()` too early, missing `AsNoTracking` on read paths, client-side evaluation.
- LINQ multiple enumeration of an `IEnumerable`.

## Rust
- `unwrap()`/`expect()` in library or production paths where errors should propagate with `?`.
- `clone()` sprinkled to placate the borrow checker (look for a design issue).
- `unsafe` blocks without a `// SAFETY:` justification.
- Blocking calls inside async runtimes; holding a `MutexGuard` across `.await`.
- Integer overflow assumptions (debug panics vs release wrapping); `as` casts that truncate.
- Public API returning concrete types where `impl Trait` would keep flexibility, or the reverse.

## SQL
- String-built queries (injection); `SELECT *` in application code.
- Missing `WHERE` on `UPDATE`/`DELETE`; missing `LIMIT` on user-facing queries.
- New query patterns without supporting indexes; functions on indexed columns in `WHERE` (defeats the index).
- `NOT IN` with nullable subqueries; implicit type coercion.
- Migrations: see principles.md section 11 (locks, expand/contract, rollback).

## Shell
- Unquoted variables (`$var` instead of `"$var"`): word splitting and globbing.
- Missing `set -euo pipefail` (or the project's equivalent) in scripts that must fail fast.
- `rm -rf "$DIR/"` where `DIR` can be empty.
- Parsing `ls` output; `cd` without checking that it succeeded.
- `curl | sh` patterns; secrets passed on the command line (visible in `ps`).

## C / C++
- Buffer overflows: `strcpy`, `sprintf`, `gets`; unchecked lengths; off-by-one on null terminators.
- Ownership: raw `new`/`delete` instead of RAII or smart pointers; use-after-free; double free.
- Undefined behavior: signed overflow, uninitialized reads, strict aliasing, data races.
- Missing virtual destructor on polymorphic bases; rule of three/five/zero violations.
- Exceptions escaping destructors; `catch (...)` that swallows.

## Ruby
- `rescue => e` that swallows; `rescue Exception` (catches signals).
- N+1 in ActiveRecord (`includes` missing); `find_by` without handling nil.
- Mass assignment without strong params; `html_safe`/`raw` on user content.
- Monkey-patching core classes; `method_missing` without `respond_to_missing?`.

## PHP
- Concatenated SQL instead of PDO prepared statements; `==` loose comparison (`"0" == false`).
- `extract()`, `eval()`, `unserialize()` on input; missing output escaping in templates.
- Errors suppressed with `@`.
