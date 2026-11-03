import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type {
  Area,
  Finding,
  Lesson,
  Progress,
  Rating,
  Review,
  Severity,
  Stage,
  Strength,
  Verdict,
} from '../types'

// The visual layer for the `pr-review` skill. Nothing here draws until that
// skill runs: the band, the transcript cards and the panel all key off state
// the skill's own tool calls create.

const P = 'pr-review-ui'
const PANE = 'pr-review'
const STAGE_TOOL = 'mcp__pr-review-ui__stage'
const PUBLISH_TOOL = 'mcp__pr-review-ui__publish'

const reviewA = atom({ plugin: 'pr-review-ui', key: 'review' } as const, null, { shape: 'review-1' })
const progressA = atom({ plugin: 'pr-review-ui', key: 'progress' } as const, null, { shape: 'progress-1' })
const selectedA = atom({ plugin: 'pr-review-ui', key: 'selected' } as const, null)
const revealedA = atom({ plugin: 'pr-review-ui', key: 'revealed' } as const, {})
const understoodA = atom({ plugin: 'pr-review-ui', key: 'understood' } as const, {})
const bandHiddenA = atom({ plugin: 'pr-review-ui', key: 'bandHidden' } as const, false)

// ------------------------------------------------------------------ vocabulary

const STAGES: { id: Stage; label: string }[] = [
  { id: 'context', label: 'Scope' },
  { id: 'intent', label: 'Intent' },
  { id: 'review', label: 'Review' },
  { id: 'verify', label: 'Verify' },
  { id: 'report', label: 'Report' },
]

const SEV: Record<Severity, { glyph: string; color: string; label: string; order: number }> = {
  blocking: { glyph: '✖', color: 'error', label: 'BLOCKING', order: 0 },
  important: { glyph: '▲', color: 'warning', label: 'IMPORTANT', order: 1 },
  suggestion: { glyph: '◆', color: 'suggestion', label: 'SUGGESTION', order: 2 },
  question: { glyph: '?', color: 'permission', label: 'QUESTION', order: 3 },
  nit: { glyph: '•', color: 'subtle', label: 'NIT', order: 4 },
}

const VERDICT: Record<Verdict, { label: string; color: string }> = {
  approve: { label: ' APPROVE ', color: 'success' },
  approve_with_suggestions: { label: ' APPROVE WITH SUGGESTIONS ', color: 'warning' },
  request_changes: { label: ' REQUEST CHANGES ', color: 'error' },
  needs_discussion: { label: ' NEEDS DISCUSSION ', color: 'permission' },
}

const RATING: Record<Rating, { glyph: string; color: string }> = {
  good: { glyph: '✔', color: 'success' },
  minor: { glyph: '◐', color: 'warning' },
  concern: { glyph: '✖', color: 'error' },
  na: { glyph: '–', color: 'subtle' },
}

// ------------------------------------------------------------------ input normalisation

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

function normalizeReview(input: unknown): Review | null {
  const r = rec(input)
  const title = str(r.title)
  if (!title) return null
  const findings: Finding[] = arr(r.findings).map((raw, i) => {
    const f = rec(raw)
    const severity = oneOf(f.severity, ['blocking', 'important', 'suggestion', 'nit', 'question'] as const, 'suggestion')
    return {
      id: str(f.id) ?? `${severity[0]!.toUpperCase()}${i + 1}`,
      severity,
      title: str(f.title) ?? 'Untitled finding',
      location: str(f.location),
      principle: str(f.principle),
      observation: str(f.observation),
      why: str(f.why),
      question: str(f.question),
      hints: arr(f.hints).map(str).filter((h): h is string => !!h).slice(0, 3),
      snippet: typeof f.snippet === 'string' && f.snippet.trim() ? f.snippet.replace(/\s+$/, '') : undefined,
      snippetStartLine: num(f.snippetStartLine),
      language: str(f.language),
    }
  })
  findings.sort((a, b) => SEV[a.severity].order - SEV[b.severity].order)
  const areas: Area[] = arr(r.areas)
    .map(rec)
    .filter(a => str(a.name))
    .map(a => ({ name: str(a.name)!, rating: oneOf(a.rating, ['good', 'minor', 'concern', 'na'] as const, 'na'), note: str(a.note) }))
  const strengths: Strength[] = arr(r.strengths)
    .map(rec)
    .filter(s => str(s.text))
    .map(s => ({ text: str(s.text)!, principle: str(s.principle), location: str(s.location) }))
  const learning: Lesson[] = arr(r.learning)
    .map(rec)
    .filter(l => str(l.principle))
    .map(l => ({ principle: str(l.principle)!, takeaway: str(l.takeaway) ?? '', resource: str(l.resource) }))
  return {
    title,
    target: str(r.target),
    files: num(r.files),
    additions: num(r.additions),
    deletions: num(r.deletions),
    verdict: oneOf(r.verdict, ['approve', 'approve_with_suggestions', 'request_changes', 'needs_discussion'] as const, 'needs_discussion'),
    intent: str(r.intent),
    summary: str(r.summary),
    areas,
    strengths,
    findings,
    learning,
  }
}

function counts(review: Review): string {
  const n = (s: Severity) => review.findings.filter(f => f.severity === s).length
  const parts: string[] = []
  const add = (s: Severity, word: string) => {
    const c = n(s)
    if (c) parts.push(`${c} ${word}${c === 1 || word.endsWith('s') ? '' : 's'}`)
  }
  add('blocking', 'blocking')
  add('important', 'important')
  add('suggestion', 'suggestion')
  add('question', 'question')
  add('nit', 'nit')
  return parts.length ? parts.join(' · ') : 'no findings'
}

function sizeLine(review: Review): string {
  const bits: string[] = []
  if (review.target) bits.push(review.target)
  if (review.files !== undefined) bits.push(`${review.files} file${review.files === 1 ? '' : 's'}`)
  if (review.additions !== undefined || review.deletions !== undefined)
    bits.push(`+${review.additions ?? 0} −${review.deletions ?? 0}`)
  return bits.join(' · ')
}

// ------------------------------------------------------------------ tool specs

const STAGE_SPEC = {
  name: 'stage',
  description:
    'pr-review skill only: report which review phase is starting, to drive the live progress bar the user sees. ' +
    'Call at the start of each phase: context (scoping the diff), intent (understanding goal & house rules), ' +
    'review (priority-ordered review), verify (falsifying candidate findings), report (writing it up).',
  inputSchema: {
    type: 'object',
    properties: {
      stage: { type: 'string', enum: ['context', 'intent', 'review', 'verify', 'report'] },
      note: { type: 'string', description: 'Short status, at most ~60 chars, e.g. "12 files · +340 −41" or "9 candidates → verifying".' },
    },
    required: ['stage'],
  },
}

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Severity letter + number: B1 blocking, I1 important, S1 suggestion, N1 nit, Q1 question.' },
    severity: { type: 'string', enum: ['blocking', 'important', 'suggestion', 'nit', 'question'] },
    title: { type: 'string', description: 'Short title, ≤ 60 chars.' },
    location: { type: 'string', description: '`path:line` (new-file line number).' },
    principle: { type: 'string', description: 'Named principle + one line, e.g. "Never mix code and data: parameterized queries (OWASP A03)".' },
    observation: { type: 'string', description: 'What the code does, stated about the code, not the person.' },
    why: { type: 'string', description: 'Concrete consequence / failure scenario in this codebase.' },
    question: { type: 'string', description: 'The guiding question that leads the author to the problem.' },
    hints: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 3,
      description: 'Exactly three progressive hints (nudge → technique name → toy-code sketch or skeleton with ___ blanks). Never the full fix. Hidden until revealed.',
    },
    snippet: { type: 'string', description: 'The ≤ 6 relevant lines of the CURRENT code (not a fix).' },
    snippetStartLine: { type: 'number', description: 'Line number of the first snippet line.' },
    language: { type: 'string', description: 'Highlighter language id, e.g. python, ts.' },
  },
  required: ['id', 'severity', 'title', 'location', 'principle', 'observation', 'why', 'question', 'hints'],
}

const PUBLISH_SPEC = {
  name: 'publish',
  description:
    'pr-review skill only: publish the finished, verified review. It is drawn as a card in the transcript and in an interactive ' +
    'panel where the author reveals hints one at a time. Call once, in the report phase, instead of printing the markdown report.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'PR title, or a one-line statement of intent.' },
      target: { type: 'string', description: 'e.g. "PR #42 · feature/x → main" or "feature/x vs main".' },
      files: { type: 'number' },
      additions: { type: 'number' },
      deletions: { type: 'number' },
      verdict: { type: 'string', enum: ['approve', 'approve_with_suggestions', 'request_changes', 'needs_discussion'] },
      intent: { type: 'string', description: 'One sentence: what the PR does and why.' },
      summary: { type: 'string', description: '2–3 sentences of senior judgment: shape of the change, main risk, main strength.' },
      areas: {
        type: 'array',
        description: 'Scorecard: Design, Correctness, Error handling, Security, Tests, Readability, Performance.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            rating: { type: 'string', enum: ['good', 'minor', 'concern', 'na'] },
            note: { type: 'string', description: '≤ 8 words.' },
          },
          required: ['name', 'rating'],
        },
      },
      strengths: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, principle: { type: 'string' }, location: { type: 'string' } },
          required: ['text'],
        },
      },
      findings: { type: 'array', items: FINDING_SCHEMA },
      learning: {
        type: 'array',
        description: 'The 1–2 principles most worth internalizing from this PR.',
        items: {
          type: 'object',
          properties: { principle: { type: 'string' }, takeaway: { type: 'string' }, resource: { type: 'string' } },
          required: ['principle', 'takeaway'],
        },
      },
    },
    required: ['title', 'verdict', 'summary', 'areas', 'findings'],
  },
}

const ADDENDUM = `

---
## PR Review UI mod: active in this session
The user has a visual layer for this skill. Use it instead of the plain-markdown report:
- Load both tools in one call if their schemas aren't loaded: ToolSearch with query "select:${STAGE_TOOL},${PUBLISH_TOOL}".
- At the start of each phase call \`${STAGE_TOOL}\` with stage = context | intent | review | verify | report and a short note (≤ 60 chars, e.g. "12 files · +340 −41", "9 candidates → verifying"). This drives a live progress bar.
- In Phase 5, call \`${PUBLISH_TOOL}\` ONCE with the complete, verified review, instead of printing the markdown template. Write all three hints for every finding now; the UI keeps them hidden until the author reveals them. Include a short snippet of the CURRENT code where it helps (never the fix).
- After publishing, the card and panel already show everything. Your closing chat message is 2–4 lines: the verdict, the one thing to look at first, and how to continue (\`hint B1\`, \`explain B1\`, \`fix B1\`, \`post\`, or the panel via /pr-review-panel). Do not repeat the review.
- If either tool errors, fall back to the markdown report.`

const isOurSkill = (name: string) => name === 'pr-review' || name.endsWith(':pr-review')

// ------------------------------------------------------------------ register

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ ...STAGE_SPEC, isDeferred: true })
    await $.tool.register({ ...PUBLISH_SPEC, isDeferred: true })
    await $.command.register({ name: 'pr-review-panel', description: 'Open the PR Review findings panel' })
    return next(e)
  })

  // The skill was invoked: start the progress band and teach the model about the UI tools.
  on('skill.prompt', async ($, e, next) => {
    const out = await next(e)
    if (!isOurSkill(e.skill)) return out
    await update($, progressA, () => ({ active: true, stage: 'context' as Stage, note: 'Starting review' }))
    await update($, bandHiddenA, () => false)
    return { text: out.text + ADDENDUM }
  })

  on('tool.call', { tool: 'mcp__pr-review-ui__stage' }, async ($, e) => {
    const input = rec(e)
    const stage = oneOf(input.stage, ['context', 'intent', 'review', 'verify', 'report'] as const, 'review')
    const note = str(input.note)?.slice(0, 80)
    await update($, progressA, () => ({ active: true, stage, note }))
    await update($, bandHiddenA, () => false)
    return { result: `Progress: ${stage}${note ? ` (${note})` : ''}` }
  }).catch(() => ({ result: 'Progress noted (display unavailable).' }))

  on('tool.call', { tool: 'mcp__pr-review-ui__publish' }, async ($, e) => {
    const review = normalizeReview(e)
    if (!review) return { deny: 'publish needs at least a title, a verdict and a findings array. Fall back to the markdown report if unsure.' }
    await update($, reviewA, () => review)
    await update($, progressA, () => null)
    await update($, revealedA, () => ({}))
    await update($, understoodA, () => ({}))
    await update($, selectedA, () => review.findings[0]?.id ?? null)
    await update($, bandHiddenA, () => false)
    const opened = await $.ui.open({ id: PANE, title: 'PR Review', columns: 70 })
    const where = opened.isPlaced
      ? 'and in the PR Review panel'
      : '(the panel waits for a wider terminal; the user can open it with /pr-review-panel)'
    return {
      result:
        `Published ${review.findings.length} finding(s), verdict ${review.verdict}. It is drawn as a card in the transcript ${where}. ` +
        'Now write only a 2–4 line closing message: verdict, the one thing to look at first, and how to continue ' +
        '(hint <id>, explain <id>, fix <id>, post). Do not repeat the review.',
    }
  }).catch(() => ({ deny: 'The review UI failed to render it. Print the markdown report from the skill instead.' }))

  // If a turn ends mid-review without publishing (interrupted, clarifying question), drop the stepper.
  on('turn.complete', async ($, e, next) => {
    const progress = await read($, progressA)
    if (progress?.active) await update($, progressA, () => null)
    return next(e)
  })

  on('command.run', { command: 'pr-review-panel' }, async $ => {
    const review = await read($, reviewA)
    if (!review) return { text: 'No PR review yet in this session. Ask for one, e.g. "review my PR".' }
    await $.ui.open({ id: PANE, title: 'PR Review', columns: 70, focus: true })
    return { text: 'PR Review panel opened. Tab moves between findings, Enter selects.' }
  })

  // ---------------------------------------------------------------- band above the prompt

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const progress = await read($, progressA)
    const review = await read($, reviewA)
    const hidden = await read($, bandHiddenA)
    const { Box, Text, Button } = $.ui.resolve(e)

    if (progress?.active) {
      const at = STAGES.findIndex(s => s.id === progress.stage)
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Text color="claude" bold>◆ PR Review</Text>
          {STAGES.map((s, i) => (
            <Text color={i < at ? 'success' : i === at ? 'claude' : 'subtle'} bold={i === at}>
              {i < at ? '✔' : i === at ? '●' : '○'} {s.label}{i < STAGES.length - 1 ? ' ─' : ''}
            </Text>
          ))}
          {progress.note && <Text dimColor wrap="truncate-end">  {progress.note}</Text>}
        </Box>
      )
    }

    if (review && !hidden) {
      const v = VERDICT[review.verdict]
      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={1} alignItems="center">
          <Text color="claude" bold>◆ PR Review</Text>
          <Text backgroundColor={v.color} color="inverseText" bold>{v.label}</Text>
          <Text dimColor>{counts(review)}</Text>
          <Button key="open" label="Open panel" hotkey="o" onPress={() => $.ui.open({ id: PANE, title: 'PR Review', columns: 70, focus: true })} />
          <Button key="hide" label="Hide" hotkey="h" onPress={() => update($, bandHiddenA, () => true)} />
        </Box>
      )
    }
    return next(e)
  })

  // ---------------------------------------------------------------- transcript rows

  on('ui.render', { component: 'ToolUse', props: { tool: 'mcp__pr-review-ui__stage' } }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const input = rec(e.props.input)
    const stage = STAGES.find(s => s.id === input.stage)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color="claude">◆</Text>
        <Text bold>PR review</Text>
        <Text color="claude">› {stage?.label ?? 'Working'}</Text>
        {str(input.note) && <Text dimColor wrap="truncate-end">{str(input.note)}</Text>}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolResult', props: { tool: 'mcp__pr-review-ui__stage' } }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolResult', props: { tool: 'mcp__pr-review-ui__publish' } }, async ($, e, next) => {
    if (e.props.isExpanded || e.props.isErrored) return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })

  on('ui.render', { component: 'ToolUse', props: { tool: 'mcp__pr-review-ui__publish' } }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const review = normalizeReview(e.props.input)
    if (!review) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const v = VERDICT[review.verdict]
    const groups = (['blocking', 'important', 'suggestion', 'question', 'nit'] as Severity[])
      .map(s => ({ s, items: review.findings.filter(f => f.severity === s) }))
      .filter(g => g.items.length)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
        <Box flexDirection="row" columnGap={1}>
          <Text color="claude" bold>◆ PR REVIEW</Text>
          <Text bold wrap="truncate-end">{review.title}</Text>
        </Box>
        {sizeLine(review) && <Text dimColor wrap="truncate-end">{sizeLine(review)}</Text>}

        <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
          <Text backgroundColor={v.color} color="inverseText" bold>{v.label}</Text>
          <Text dimColor>{counts(review)}</Text>
        </Box>
        {review.summary && <Box marginTop={1}><Text>{review.summary}</Text></Box>}

        {review.areas.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
            {review.areas.map(a => (
              <Text>
                <Text color={RATING[a.rating].color} bold>{RATING[a.rating].glyph}</Text> {a.name}
              </Text>
            ))}
          </Box>
        )}

        {groups.map(g => (
          <Box flexDirection="column" marginTop={1}>
            <Text color={SEV[g.s].color} bold>▍{SEV[g.s].label} ({g.items.length})</Text>
            {g.items.map(f => (
              <Box flexDirection="column" paddingLeft={2}>
                <Box flexDirection="row" columnGap={1}>
                  <Text color={SEV[f.severity].color} bold>{SEV[f.severity].glyph} {f.id}</Text>
                  <Box flexGrow={1} flexShrink={1}><Text wrap="truncate-end">{f.title}</Text></Box>
                  {f.location && <Text color="subtle" wrap="truncate-start">{f.location}</Text>}
                </Box>
                {f.principle && (
                  <Box paddingLeft={4}><Text dimColor italic wrap="truncate-end">{f.principle}</Text></Box>
                )}
              </Box>
            ))}
          </Box>
        ))}

        {review.strengths.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="success" bold>★ Done well</Text>
            {review.strengths.map(s => (
              <Box paddingLeft={2}>
                <Text wrap="wrap">
                  {s.text}
                  {s.principle ? <Text dimColor italic> ({s.principle})</Text> : ''}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {review.learning.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="claude" bold>◇ Learning focus</Text>
            {review.learning.map(l => (
              <Box paddingLeft={2}>
                <Text wrap="wrap">
                  <Text bold>{l.principle}</Text>{l.takeaway ? `: ${l.takeaway}` : ''}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            hint &lt;id&gt; · explain &lt;id&gt; · fix &lt;id&gt; · post · /pr-review-panel for details
          </Text>
        </Box>
      </Box>
    )
  })

  // ---------------------------------------------------------------- the panel

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Code } = $.ui.resolve(e)
    const review = await read($, reviewA)
    if (!review) return <Text dimColor>No review yet. Ask Claude to review a PR.</Text>

    const selectedId = await read($, selectedA)
    const revealed = await read($, revealedA)
    const understood = await read($, understoodA)
    const sel = review.findings.find(f => f.id === selectedId) ?? review.findings[0]
    const v = VERDICT[review.verdict]
    const done = review.findings.filter(f => understood[f.id]).length

    const detail = (f: Finding) => {
      const shown = Math.min(revealed[f.id] ?? 0, f.hints.length)
      const s = SEV[f.severity]
      return (
        <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={s.color} paddingX={1}>
          <Box flexDirection="row" columnGap={1}>
            <Text color={s.color} bold>{s.glyph} {f.id} · {s.label}</Text>
            {f.location && <Text color="subtle" wrap="truncate-start">{f.location}</Text>}
          </Box>
          <Text bold wrap="wrap">{f.title}</Text>
          {f.snippet && (
            <Box marginTop={1}>
              <Code source={f.snippet} language={f.language} path={f.location?.split(':')[0]} startLine={f.snippetStartLine} wrap="truncate-end" />
            </Box>
          )}
          {f.observation && (
            <Box marginTop={1}><Text wrap="wrap"><Text bold>What I see  </Text>{f.observation}</Text></Box>
          )}
          {f.why && <Text wrap="wrap"><Text bold>Why it matters  </Text>{f.why}</Text>}
          {f.principle && <Text wrap="wrap"><Text bold>Principle  </Text><Text italic>{f.principle}</Text></Text>}
          {f.question && (
            <Box marginTop={1}><Text color="claude" wrap="wrap"><Text bold>Think about  </Text>{f.question}</Text></Box>
          )}
          {f.hints.slice(0, shown).map((hint, i) => (
            <Box marginTop={i === 0 ? 1 : 0}>
              <Text wrap="wrap"><Text color="warning" bold>💡 Hint {i + 1}  </Text>{hint}</Text>
            </Box>
          ))}
          <Box flexDirection="row" columnGap={1} marginTop={1} flexWrap="wrap">
            {shown < f.hints.length && (
              <Button
                key={`hint-${f.id}`}
                hotkey="h"
                variant="primary"
                label={`Reveal hint ${shown + 1}/${f.hints.length}`}
                onPress={() => update($, revealedA, m => ({ ...m, [f.id]: Math.min((m[f.id] ?? 0) + 1, f.hints.length) }))}
              />
            )}
            <Button
              key={`explain-${f.id}`}
              hotkey="e"
              label="Ask Claude to explain"
              onPress={() => $.prompt.fill({ text: `explain ${f.id}`, mode: 'replace' })}
            />
            <Button
              key={`got-${f.id}`}
              hotkey="u"
              label={understood[f.id] ? '✓ Understood' : 'Mark understood'}
              onPress={() => update($, understoodA, m => ({ ...m, [f.id]: !m[f.id] }))}
            />
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate-end">{review.title}</Text>
        <Box flexDirection="row" columnGap={1} flexWrap="wrap">
          <Text backgroundColor={v.color} color="inverseText" bold>{v.label}</Text>
          <Text dimColor>{done}/{review.findings.length} understood</Text>
        </Box>
        {review.intent && <Text dimColor wrap="wrap">{review.intent}</Text>}

        <Box flexDirection="column" marginTop={1}>
          {review.findings.length === 0 && <Text color="success">No findings: clean PR. ★</Text>}
          {review.findings.map(f => {
            const s = SEV[f.severity]
            const isSel = sel?.id === f.id
            return (
              <Button key={`f-${f.id}`} plain onPress={() => update($, selectedA, () => f.id)}>
                <Text color={isSel ? 'claude' : 'subtle'}>{isSel ? '❯ ' : '  '}</Text>
                <Text color={s.color} bold>{understood[f.id] ? '✓' : s.glyph} {f.id.padEnd(3)}</Text>
                <Text dimColor={!!understood[f.id]} bold={isSel}> {f.title}</Text>
              </Button>
            )
          })}
        </Box>

        {sel && detail(sel)}

        {review.learning.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="claude" bold>◇ Learning focus</Text>
            {review.learning.map(l => (
              <Text wrap="wrap"><Text bold>{l.principle}</Text>{l.takeaway ? `: ${l.takeaway}` : ''}{l.resource ? <Text dimColor> ({l.resource})</Text> : ''}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
