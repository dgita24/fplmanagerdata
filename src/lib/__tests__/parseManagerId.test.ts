import { describe, it, expect } from 'vitest'
import { parseManagerIdFromInput } from '../parseManagerId'

describe('parseManagerIdFromInput', () => {
  it('returns null for empty string', () => {
    expect(parseManagerIdFromInput('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseManagerIdFromInput('   ')).toBeNull()
  })

  it('parses a plain numeric ID', () => {
    expect(parseManagerIdFromInput('123456')).toBe(123456)
  })

  it('parses a plain numeric ID with surrounding whitespace', () => {
    expect(parseManagerIdFromInput('  44  ')).toBe(44)
  })

  it('parses an ID from a standard FPL entry URL', () => {
    expect(parseManagerIdFromInput('https://fantasy.premierleague.com/entry/123456/event/25')).toBe(123456)
  })

  it('parses an ID from a FPL entry URL without trailing path', () => {
    expect(parseManagerIdFromInput('https://fantasy.premierleague.com/entry/789/')).toBe(789)
  })

  it('parses an ID from a partial FPL entry URL', () => {
    expect(parseManagerIdFromInput('/entry/42/event/1')).toBe(42)
  })

  it('falls back to extracting a long number from arbitrary text', () => {
    expect(parseManagerIdFromInput('Manager ID: 99988')).toBe(99988)
  })

  it('returns null when no numeric ID can be found', () => {
    expect(parseManagerIdFromInput('no numbers here')).toBeNull()
  })

  it('ignores short numbers (fewer than 3 digits) in fallback path', () => {
    // Falls back to the \b(\d{3,})\b pattern: "12" is less than 3 digits, returns null
    expect(parseManagerIdFromInput('just 12')).toBeNull()
  })

  it('returns null for non-string-like input coerced to empty', () => {
    // @ts-expect-error testing runtime null handling
    expect(parseManagerIdFromInput(null)).toBeNull()
  })
})
