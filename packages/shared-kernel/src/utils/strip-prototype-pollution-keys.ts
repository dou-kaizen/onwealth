const POLLUTING_KEYS = ['__proto__', 'constructor', 'prototype'] as const

const DEFAULT_MAX_DEPTH = 32

/**
 * Options for {@link stripPrototypePollutionKeys}.
 *
 * `maxDepth` bounds the recursive walk so adversarial deeply-nested input
 * cannot block the event loop.
 */
export interface StripOptions {
  maxDepth?: number
}

/**
 * Recursively delete prototype-polluting keys from a plain object IN PLACE.
 *
 * Defends against payloads like `{ "__proto__": { "polluted": true } }`
 * landing on `Object.prototype` via downstream object lookups, template
 * engines, or unsafe DI key resolution. Used by `QueueProcessorBase.process()`
 * as defense-in-depth — concrete processors should still Zod-validate
 * `job.data` for structural correctness.
 *
 * **Safety guarantees:**
 * - `WeakSet` visited guard against circular refs (Express `Request`,
 *   Drizzle back-refs). Without it the walk would infinite-loop.
 * - `maxDepth` cap (default 32) bounds work on adversarial deep nesting.
 * - Skips `Map`, `Set`, `Date`, typed arrays, and any non-plain-object
 *   instance — only walks Object-literal-shaped values, so class instances
 *   with sensible prototypes are not corrupted.
 *
 * @param value Mutated in place; structurally typed as `unknown` because
 *              callers commonly invoke this on freshly-deserialised JSON.
 * @param opts.maxDepth Defaults to {@link DEFAULT_MAX_DEPTH}; deeper levels
 *                      are left untouched.
 */
export function stripPrototypePollutionKeys(value: unknown, opts: StripOptions = {}): void {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  const seen = new WeakSet<object>()
  walk(value, 0, maxDepth, seen)
}

/**
 * Recursive worker for {@link stripPrototypePollutionKeys}.
 *
 * Uses `Object.hasOwn` so only OWN keys are stripped — inherited properties
 * (which we cannot `delete` anyway without breaking other instances) are
 * left alone.
 *
 * @internal
 */
function walk(value: unknown, depth: number, maxDepth: number, seen: WeakSet<object>): void {
  if (depth >= maxDepth) return
  if (value === null || typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)

  if (Array.isArray(value)) {
    for (const item of value) walk(item, depth + 1, maxDepth, seen)
    return
  }

  if (!isPlainObject(value)) return

  const obj = value as Record<string, unknown>
  for (const key of POLLUTING_KEYS) {
    if (Object.hasOwn(obj, key)) delete obj[key]
  }
  for (const child of Object.values(obj)) {
    walk(child, depth + 1, maxDepth, seen)
  }
}

/**
 * `true` if `value` is an Object literal or a `null`-prototype object —
 * the only shapes we should mutate.
 *
 * @internal
 */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}
