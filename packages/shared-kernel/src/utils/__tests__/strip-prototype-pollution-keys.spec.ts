import { describe, expect, it } from 'vitest'
import { stripPrototypePollutionKeys } from '../strip-prototype-pollution-keys.js'

// IMPORTANT: object-literal `{ __proto__: ... }` syntax SETS the prototype
// (special-cased by the spec); it does NOT create an own `__proto__` property.
// Real-world prototype-pollution payloads arrive via `JSON.parse`, which DOES
// create the own property. Tests below use `JSON.parse` to mirror BullMQ's
// payload deserialization path.

describe('stripPrototypePollutionKeys', () => {
  it('strips top-level __proto__', () => {
    const input = JSON.parse('{"__proto__": {"polluted": true}, "ok": 1}')
    stripPrototypePollutionKeys(input)
    expect(Object.hasOwn(input, '__proto__')).toBe(false)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(input.ok).toBe(1)
  })

  it('strips nested __proto__ / constructor / prototype', () => {
    const input = JSON.parse(
      '{"nested": {"__proto__": {"polluted": true}, "constructor": {"bad": 1}, "prototype": {"bad": 1}}}',
    )
    stripPrototypePollutionKeys(input)
    expect(Object.hasOwn(input.nested, '__proto__')).toBe(false)
    expect(Object.hasOwn(input.nested, 'constructor')).toBe(false)
    expect(Object.hasOwn(input.nested, 'prototype')).toBe(false)
  })

  it('walks into arrays', () => {
    const input = JSON.parse('{"items": [{"__proto__": {"x": 1}}, {"ok": 1}]}')
    stripPrototypePollutionKeys(input)
    const first = input.items[0] as Record<string, unknown>
    expect(Object.hasOwn(first, '__proto__')).toBe(false)
  })

  it('does not infinite-loop on circular references', () => {
    const a = JSON.parse('{"__proto__": {"p": 1}}') as Record<string, unknown>
    a.self = a
    expect(() => stripPrototypePollutionKeys(a)).not.toThrow()
    expect(Object.hasOwn(a, '__proto__')).toBe(false)
  })

  it('respects maxDepth', () => {
    // Build a 5-deep chain where every level has an own `__proto__` key.
    const deep = JSON.parse(
      '{"__proto__":{"p":1},"next":{"__proto__":{"p":1},"next":{"__proto__":{"p":1},"next":{"__proto__":{"p":1},"next":{"__proto__":{"p":1}}}}}}',
    )
    stripPrototypePollutionKeys(deep, { maxDepth: 2 })
    expect(Object.hasOwn(deep, '__proto__')).toBe(false)
    const lvl2 = deep.next.next
    // Beyond depth-2 we stopped walking, so the __proto__ key may remain.
    expect(Object.hasOwn(lvl2, '__proto__')).toBe(true)
  })

  it('leaves non-plain-object instances alone', () => {
    const map = new Map<string, unknown>()
    map.set('__proto__', { p: 1 })
    const input = { map }
    stripPrototypePollutionKeys(input)
    // Map entry preserved — we only walk plain objects + arrays.
    expect(map.get('__proto__')).toEqual({ p: 1 })
  })

  it('handles primitives without throwing', () => {
    expect(() => stripPrototypePollutionKeys(null)).not.toThrow()
    expect(() => stripPrototypePollutionKeys('string')).not.toThrow()
    expect(() => stripPrototypePollutionKeys(42)).not.toThrow()
    expect(() => stripPrototypePollutionKeys(undefined)).not.toThrow()
  })

  it('does NOT pollute Object.prototype after stripping', () => {
    const input = JSON.parse('{"__proto__": {"polluted": "oops"}}')
    stripPrototypePollutionKeys(input)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
