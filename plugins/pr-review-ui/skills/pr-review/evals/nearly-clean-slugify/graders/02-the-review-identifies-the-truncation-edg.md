---
type: llm
focus: trace
weight: 1
---

The review identifies the truncation edge case: when the cut ends exactly at a word boundary (next char is a hyphen) rsplit drops a complete word, e.g. slugify('alpha beta gamma', max_length=10) returns 'alpha'
