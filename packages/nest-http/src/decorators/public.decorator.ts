import { SetMetadata } from '@nestjs/common'

/** Metadata key read by future auth guards to skip authentication. */
export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Mark a route as public — auth guards MUST short-circuit when this
 * metadata is present.
 *
 * **Precondition — this decorator is a NO-OP until a global auth guard is
 * wired.** Applying `@Public()` to a route today has no effect.
 *
 * For `@Public()` to work, any guard that enforces authentication MUST
 * explicitly check this metadata:
 * ```typescript
 * const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
 *   context.getHandler(),
 *   context.getClass(),
 * ])
 * if (isPublic) return true
 * ```
 *
 * The decorator is retained as a scaffolding contract so route annotations
 * do not need to change once the M3 auth module lands. See
 * `docs/project-roadmap.md` for the auth milestone.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)
