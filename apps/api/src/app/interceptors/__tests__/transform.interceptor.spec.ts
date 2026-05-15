import { InternalServerErrorException, StreamableFile } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { firstValueFrom, lastValueFrom, of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'

import { TransformInterceptor } from '../transform.interceptor.js'

function makeCtx() {
  return { getHandler: () => ({}), getClass: () => ({}) } as never
}

function makeNext<T>(value: T) {
  return { handle: () => of(value) } as never
}

function buildInterceptor(envelope: boolean) {
  const reflector = new Reflector()
  vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(envelope)
  return new TransformInterceptor(reflector)
}

describe('TransformInterceptor', () => {
  it('passes through single resource without @UseEnvelope', async () => {
    const itc = buildInterceptor(false)
    const out = await firstValueFrom(itc.intercept(makeCtx(), makeNext({ id: 'u1' })))
    expect(out).toEqual({ id: 'u1' })
  })

  it('passes through null and undefined', async () => {
    const itc = buildInterceptor(true)
    expect(await firstValueFrom(itc.intercept(makeCtx(), makeNext(null)))).toBeNull()
    expect(await firstValueFrom(itc.intercept(makeCtx(), makeNext(undefined)))).toBeUndefined()
  })

  it('wraps raw array when @UseEnvelope', async () => {
    const itc = buildInterceptor(true)
    const out = await firstValueFrom(itc.intercept(makeCtx(), makeNext([1, 2, 3])))
    expect(out).toEqual({ object: 'list', data: [1, 2, 3] })
  })

  it('passes through pre-shaped list envelope (e.g., OffsetListResponseDto)', async () => {
    const itc = buildInterceptor(true)
    const shaped = {
      object: 'list',
      data: [{ id: 'a' }],
      page: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
    }
    const out = await firstValueFrom(itc.intercept(makeCtx(), makeNext(shaped)))
    expect(out).toBe(shaped)
  })

  it('throws InternalServerErrorException on @UseEnvelope + non-list object', async () => {
    const itc = buildInterceptor(true)
    await expect(
      lastValueFrom(itc.intercept(makeCtx(), makeNext({ id: 'u1' }))),
    ).rejects.toBeInstanceOf(InternalServerErrorException)
  })

  it('skips StreamableFile', async () => {
    const itc = buildInterceptor(true)
    const file = new StreamableFile(Buffer.from('hi'))
    const out = await firstValueFrom(itc.intercept(makeCtx(), makeNext(file)))
    expect(out).toBe(file)
  })

  it('skips Buffer', async () => {
    const itc = buildInterceptor(true)
    const buf = Buffer.from('bin')
    const out = await firstValueFrom(itc.intercept(makeCtx(), makeNext(buf)))
    expect(out).toBe(buf)
  })
})
