export type Severity = 'blocking' | 'important' | 'suggestion' | 'nit' | 'question'
export type Rating = 'good' | 'minor' | 'concern' | 'na'
export type Verdict = 'approve' | 'approve_with_suggestions' | 'request_changes' | 'needs_discussion'
export type Stage = 'context' | 'intent' | 'review' | 'verify' | 'report'

export type Finding = {
  id: string
  severity: Severity
  title: string
  location?: string
  principle?: string
  observation?: string
  why?: string
  question?: string
  hints: string[]
  snippet?: string
  snippetStartLine?: number
  language?: string
}

export type Area = { name: string; rating: Rating; note?: string }
export type Strength = { text: string; principle?: string; location?: string }
export type Lesson = { principle: string; takeaway: string; resource?: string }

export type Review = {
  title: string
  target?: string
  files?: number
  additions?: number
  deletions?: number
  verdict: Verdict
  intent?: string
  summary?: string
  areas: Area[]
  strengths: Strength[]
  findings: Finding[]
  learning: Lesson[]
}

export type Progress = { active: boolean; stage: Stage; note?: string }

declare module 'claude-code' {
  interface PluginState {
    'pr-review-ui': {
      review: Shaped<Review | null>
      progress: Shaped<Progress | null>
      selected: string | null
      revealed: Record<string, number>
      understood: Record<string, boolean>
      bandHidden: boolean
    }
  }
}
