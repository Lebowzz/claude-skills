import { expect, test } from 'claude-code/testing'

const REVIEW = {
  title: 'Add discount codes to order total',
  target: 'feature/discounts vs main',
  files: 3,
  additions: 21,
  deletions: 2,
  verdict: 'request_changes',
  intent: 'Lets checkout apply a percentage discount code to the order total.',
  summary: 'Small, focused change, but the discount lookup is injectable and failures are silent.',
  areas: [
    { name: 'Design', rating: 'minor', note: 'DB access inside a pure calc' },
    { name: 'Security', rating: 'concern', note: 'SQL injection, hardcoded key' },
    { name: 'Tests', rating: 'concern', note: 'no tests for discounts' },
  ],
  strengths: [{ text: 'Keeps the public signature backward compatible', principle: 'Open/Closed' }],
  findings: [
    {
      id: 'S1', severity: 'suggestion', title: 'Loop could stay a sum()', location: 'app/orders.py:7',
      principle: 'KISS', observation: 'o', why: 'w', question: 'q', hints: ['a', 'b', 'c'],
    },
    {
      id: 'B1', severity: 'blocking', title: 'SQL built from the discount code', location: 'app/orders.py:11',
      principle: 'Never mix code and data: parameterized queries (OWASP A03)',
      observation: 'discount_code is interpolated into the SQL string.',
      why: "A code of x' OR '1'='1 matches every row.",
      question: 'Can the database tell which part you wrote and which part the user typed?',
      hints: ['Look at execute()’s signature.', 'Parameterized queries: ? placeholders.', 'cur.execute("... WHERE s = ?", (s,))'],
      snippet: 'row = conn.execute(f"SELECT pct FROM discounts WHERE code = \'{discount_code}\'").fetchone()',
      snippetStartLine: 11,
      language: 'python',
    },
  ],
  learning: [{ principle: 'Fail fast', takeaway: 'An error you swallow becomes a wrong number later.' }],
}

const setup = async ($: any, on: any) => {
  on('command.register', () => ({ value: { command: 'pr-review-panel' } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__pr-review-ui__${e.name}` } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('skill.prompt', (_: unknown, e: any) => ({ text: e.text }))
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  // Stands for the engine's own drawing when the mod passes.
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const SURFACES = ['terminal', 'desktop'] as const

test('the publish card draws verdict, findings and principle on every surface', async ($, on) => {
  await setup($, on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      plugin: 'pr-review-ui',
      surface,
      component: 'ToolUse',
      requestId: 'tu1',
      props: {
        tool_use_id: 'tu1', tool: 'mcp__pr-review-ui__publish', input: REVIEW,
        isRunning: false, isErrored: false, isInterrupted: false,
      },
    } as any)
    expect(await ui.find({ type: 'Text', text: /REQUEST CHANGES/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /SQL built from the discount code/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 blocking · 1 suggestion/ })).toBeDefined()
    await ui.unmount()
  }
})

test('stage drives the progress band, publish replaces it with the summary', async ($, on) => {
  await setup($, on)
  await $.tool.call({ tool: 'mcp__pr-review-ui__stage', stage: 'verify', note: '9 candidates' } as any)
  const BAND = {
    plugin: 'pr-review-ui', component: 'AbovePrompt', requestId: 'band',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  }
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Text', text: /● Verify/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /✔ Review/ })).toBeDefined()
  await ui.unmount()

  const res: any = await $.tool.call({ tool: 'mcp__pr-review-ui__publish', ...REVIEW } as any)
  expect(String(res.result ?? res.text)).toContain('Published 2 finding(s)')
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as any)
  expect(await ui.find({ type: 'Text', text: /REQUEST CHANGES/ })).toBeDefined()
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /REQUEST CHANGES/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})

test('the panel selects the blocking finding first and reveals hints one at a time', async ($, on) => {
  await setup($, on)
  for (const surface of SURFACES) {
    // Each publish starts the panel afresh: first finding selected, no hints shown.
    await $.tool.call({ tool: 'mcp__pr-review-ui__publish', ...REVIEW } as any)
    const ui = await $.ui.mount({
      plugin: 'pr-review-ui', surface, component: 'Pane', requestId: 'pr-review',
      props: { title: 'PR Review', isFocused: true, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    } as any)
    expect(await ui.find({ type: 'Text', text: /Think about/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Hint 1/ })).toBeUndefined()
    await ui.press({ key: 'hint-B1' })
    expect(await ui.find({ type: 'Text', text: /Hint 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Hint 2/ })).toBeUndefined()
    await ui.press({ key: 'f-S1' })
    expect(await ui.find({ type: 'Text', text: /Loop could stay a sum/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a malformed publish is refused so the model falls back to markdown', async ($, on) => {
  await setup($, on)
  const res: any = await $.tool.call({ tool: 'mcp__pr-review-ui__publish', verdict: 'approve' } as any)
  expect(JSON.stringify(res)).toContain('title')
})

test('nothing draws before the skill runs', async ($, on) => {
  await setup($, on)
  const ui = await $.ui.mount({
    plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  } as any)
  expect(await ui.find({ type: 'Text', text: /PR Review/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
  await ui.unmount()
})

test('invoking the skill starts the band and appends the UI instructions', async ($, on) => {
  await setup($, on)
  const out: any = await $.skill.prompt({ skill: 'pr-review', text: 'BODY' } as any)
  expect(out.text).toContain('BODY')
  expect(out.text).toContain('mcp__pr-review-ui__publish')
  const other: any = await $.skill.prompt({ skill: 'commit', text: 'X' } as any)
  expect(other.text).toBe('X')
  const ui = await $.ui.mount({
    plugin: 'pr-review-ui', surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
    props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
  } as any)
  expect(await ui.find({ type: 'Text', text: /● Scope/ })).toBeDefined()
  await ui.unmount()
})
