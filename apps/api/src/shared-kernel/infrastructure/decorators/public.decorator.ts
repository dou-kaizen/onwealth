import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Marks a route as public, bypassing any auth guard.
 *
 * No global auth guard is currently wired; decorator retained as scaffolding
 * for when an auth module is added.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
