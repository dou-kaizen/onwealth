import { describe, expect, it } from 'vitest'
import { sanitizeHeaderValue } from '../sanitize-header-value.js'

describe('sanitizeHeaderValue', () => {
  it('returns undefined for undefined/null', () => {
    expect(sanitizeHeaderValue(undefined)).toBeUndefined()
    expect(sanitizeHeaderValue(null)).toBeUndefined()
  })

  it('returns plain string unchanged', () => {
    expect(sanitizeHeaderValue('abc-123_xyz')).toBe('abc-123_xyz')
  })

  it('strips CR / LF / CRLF', () => {
    expect(sanitizeHeaderValue('a\rb\nc\r\nd')).toBe('abcd')
  })

  it('strips TAB and NUL', () => {
    expect(sanitizeHeaderValue('a\tb\0c')).toBe('abc')
  })

  it('strips ANSI escape sequences', () => {
    expect(sanitizeHeaderValue('\x1b[31mred\x1b[0m')).toBe('red')
  })

  it('truncates to 128 chars', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeHeaderValue(long)).toHaveLength(128)
  })

  it('coerces non-string input via String()', () => {
    expect(sanitizeHeaderValue(123)).toBe('123')
    expect(sanitizeHeaderValue(true)).toBe('true')
  })

  it('returns empty string when input is empty', () => {
    expect(sanitizeHeaderValue('')).toBe('')
  })
})
