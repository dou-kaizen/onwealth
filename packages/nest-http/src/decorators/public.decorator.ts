import { SetMetadata } from '@nestjs/common'

/** Metadata key read by future auth guards to skip authentication. */
export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Mark a route as public — auth guards must short-circuit when this
 * metadata is present.
 *
 * @remarks
 * No global auth guard is currently wired. Decorator retained as a
 * scaffolding contract so handler annotations don't need to change once
 * an auth module is added.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
