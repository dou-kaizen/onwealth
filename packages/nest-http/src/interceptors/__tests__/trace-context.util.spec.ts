import { describe, expect, it } from 'vitest'
import { isValidTraceparent, parseTraceparent } from '../trace-context.util.js'

/**
 * W3C Trace Context parser unit tests.
 *
 * Specification: https://www.w3.org/TR/trace-context/
 * Key spec rules exercised here:
 *   - version 'ff' is reserved and MUST be rejected (§2.2.1)
 *   - all-zero trace-id means "not sampled / no active trace" (§2.2.3)
 *   - all-zero parent-id means "no valid span ancestor" (§2.2.4)
 */

const VALID_TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
const ALL_ZERO_TRACE_ID = '00-00000000000000000000000000000000-00f067aa0ba902b7-01'
const ALL_ZERO_PARENT_ID = '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'
const FF_VERSION = 'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'

describe('parseTraceparent', () => {
  it('parses a valid traceparent and returns all fields', () => {
    const result = parseTraceparent(VALID_TRACEPARENT)
    expect(result).toEqual({
      version: '00',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      parentId: '00f067aa0ba902b7',
      traceFlags: '01',
    })
  })

  it('returns null for an empty string', () => {
    expect(parseTraceparent('')).toBeNull()
  })

  it('returns null for a malformed header (wrong segment count)', () => {
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-01')).toBeNull()
  })

  it('returns null when trace-id length is wrong', () => {
    // trace-id too short (31 hex chars instead of 32)
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e47-00f067aa0ba902b7-01')).toBeNull()
  })

  it('returns null when parent-id length is wrong', () => {
    // parent-id too short (15 hex chars instead of 16)
    expect(parseTraceparent('00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b-01')).toBeNull()
  })

  it('returns null for non-hex characters in any segment', () => {
    expect(parseTraceparent('00-ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ-00f067aa0ba902b7-01')).toBeNull()
  })

  // W3C §2.2.1 — version 'ff' is reserved
  it('returns null when version is ff (reserved)', () => {
    expect(parseTraceparent(FF_VERSION)).toBeNull()
  })

  // W3C §2.2.3 — all-zero trace-id is invalid
  it('returns null when trace-id is all zeros', () => {
    expect(parseTraceparent(ALL_ZERO_TRACE_ID)).toBeNull()
  })

  // W3C §2.2.4 — all-zero parent-id is invalid
  it('returns null when parent-id is all zeros', () => {
    expect(parseTraceparent(ALL_ZERO_PARENT_ID)).toBeNull()
  })
})

describe('isValidTraceparent', () => {
  it('returns true for a well-formed traceparent', () => {
    expect(isValidTraceparent(VALID_TRACEPARENT)).toBe(true)
  })

  it('returns false for ff version', () => {
    expect(isValidTraceparent(FF_VERSION)).toBe(false)
  })

  it('returns false for all-zero trace-id', () => {
    expect(isValidTraceparent(ALL_ZERO_TRACE_ID)).toBe(false)
  })

  it('returns false for all-zero parent-id', () => {
    expect(isValidTraceparent(ALL_ZERO_PARENT_ID)).toBe(false)
  })

  it('returns false for an empty string', () => {
    expect(isValidTraceparent('')).toBe(false)
  })
})
