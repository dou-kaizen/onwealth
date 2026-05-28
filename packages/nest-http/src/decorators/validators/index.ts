import { ErrorCode } from '@boilerplate/shared-kernel'
import { applyDecorators } from '@nestjs/common'
import type { ValidationOptions } from 'class-validator'
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

/**
 * Field-level validator wrappers that inject a stable {@link ErrorCode} into
 * the class-validator `context`. The exceptions filter reads that context to
 * produce machine-readable codes in RFC 9457 Problem Details responses, so
 * always prefer these wrappers over the raw class-validator decorators —
 * raw decorators leave `code` empty and force the filter to fall back to
 * `INVALID_FORMAT`.
 *
 * Each wrapper accepts the standard `ValidationOptions` so messages,
 * `each`, and `groups` continue to work transparently.
 */

/** Email format. Tagged `INVALID_EMAIL`. */
export function IsEmailField(options?: ValidationOptions) {
  return applyDecorators(IsEmail({}, { ...options, context: { code: ErrorCode.INVALID_EMAIL } }))
}

/** String type. Tagged `INVALID_FORMAT`. */
export function IsStringField(options?: ValidationOptions) {
  return applyDecorators(IsString({ ...options, context: { code: ErrorCode.INVALID_FORMAT } }))
}

/** Integer type. Tagged `INVALID_FORMAT`. */
export function IsIntField(options?: ValidationOptions) {
  return applyDecorators(IsInt({ ...options, context: { code: ErrorCode.INVALID_FORMAT } }))
}

/** Required (non-empty). Tagged `REQUIRED_FIELD`. */
export function IsNotEmptyField(options?: ValidationOptions) {
  return applyDecorators(IsNotEmpty({ ...options, context: { code: ErrorCode.REQUIRED_FIELD } }))
}

/**
 * UUID format. Tagged `INVALID_UUID`.
 *
 * @param version — UUID version to enforce; defaults to any version when
 *                  omitted. Pass `'4'` to lock down random UUIDs.
 */
export function IsUUIDField(version?: '3' | '4' | '5' | 'all', options?: ValidationOptions) {
  return applyDecorators(IsUUID(version, { ...options, context: { code: ErrorCode.INVALID_UUID } }))
}

/** Minimum string length. Tagged `INVALID_LENGTH`. */
export function MinLengthField(min: number, options?: ValidationOptions) {
  return applyDecorators(
    MinLength(min, { ...options, context: { code: ErrorCode.INVALID_LENGTH } }),
  )
}

/** Maximum string length. Tagged `INVALID_LENGTH`. */
export function MaxLengthField(max: number, options?: ValidationOptions) {
  return applyDecorators(
    MaxLength(max, { ...options, context: { code: ErrorCode.INVALID_LENGTH } }),
  )
}

/** Minimum numeric value. Tagged `OUT_OF_RANGE`. */
export function MinField(min: number, options?: ValidationOptions) {
  return applyDecorators(Min(min, { ...options, context: { code: ErrorCode.OUT_OF_RANGE } }))
}

/** Maximum numeric value. Tagged `OUT_OF_RANGE`. */
export function MaxField(max: number, options?: ValidationOptions) {
  return applyDecorators(Max(max, { ...options, context: { code: ErrorCode.OUT_OF_RANGE } }))
}

/** Regex match. Tagged `INVALID_FORMAT`. */
export function MatchesField(pattern: RegExp, options?: ValidationOptions) {
  return applyDecorators(
    Matches(pattern, { ...options, context: { code: ErrorCode.INVALID_FORMAT } }),
  )
}

/** Allowlist membership. Tagged `INVALID_FORMAT`. */
export function IsInField(values: unknown[], options?: ValidationOptions) {
  return applyDecorators(IsIn(values, { ...options, context: { code: ErrorCode.INVALID_FORMAT } }))
}

/** Boolean type. Tagged `INVALID_FORMAT`. */
export function IsBooleanField(options?: ValidationOptions) {
  return applyDecorators(IsBoolean({ ...options, context: { code: ErrorCode.INVALID_FORMAT } }))
}
