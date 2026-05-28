/**
 * Unit tests for the Next.js adapter. We never import `next` — instead we
 * synthesise the webpack-callback context that Next would pass.
 *
 * Coverage focus:
 *  - withCodeConnect returns a merged config that preserves user fields.
 *  - resolve.alias (webpack pipeline) AND experimental.turbo.resolveAlias
 *    both carry the runtime mapping.
 *  - The user's existing `webpack` function is composed correctly.
 *  - `enabled` resolution: default = `NODE_ENV !== 'production'`, plus
 *    explicit `true`/`false` overrides.
 */

import { withCodeConnect } from '..'

function ctxFor(opts: { dev: boolean; isServer: boolean; dir?: string }) {
  return {
    dev: opts.dev,
    isServer: opts.isServer,
    dir: opts.dir ?? '/proj',
  }
}

/** Run `fn` with `process.env.NODE_ENV` set to `value` (or unset if undefined),
 *  then restore the original value. Lets us assert NODE_ENV-gated branches
 *  without polluting the rest of the test file (jest defaults NODE_ENV to
 *  `'test'`, which is `!== 'production'` → enabled). */
function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.NODE_ENV
  if (value === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = value
  }
  try {
    return fn()
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previous
    }
  }
}

describe('nextjs withCodeConnect()', () => {
  it('returns a config with the original fields preserved', () => {
    const result = withCodeConnect({ webpack: undefined, experimental: { something: 'kept' } as never })
    expect((result.experimental as { something?: string }).something).toBe('kept')
    expect(typeof result.webpack).toBe('function')
    expect(result.experimental!.turbo!.resolveAlias!['@figma/code-connect/register']).toMatch(
      /runtime\.js$/,
    )
  })

  describe('webpack pipeline alias', () => {
    it('adds the runtime alias to config.resolve.alias for every bundle', () => {
      const next = withCodeConnect()
      const ctx = ctxFor({ dev: true, isServer: false })
      const config = next.webpack!({ resolve: { alias: {} } }, ctx)
      expect(config.resolve!.alias!['@figma/code-connect/register']).toMatch(/runtime\.js$/)
    })

    it('also adds the alias on the server bundle (alias is render-target-agnostic)', () => {
      const next = withCodeConnect()
      const ctx = ctxFor({ dev: true, isServer: true })
      const config = next.webpack!({ resolve: { alias: {} } }, ctx)
      // The alias is harmless on the server — the runtime shim is SSR-safe
      // (typeof window === 'undefined' short-circuit) and tree-shakes when
      // the user's import is gated by `if (typeof window !== 'undefined')`.
      expect(config.resolve!.alias!['@figma/code-connect/register']).toMatch(/runtime\.js$/)
    })

    it('preserves the user-supplied webpack() function (composition order)', () => {
      const userTouched: NodeJS.Dict<boolean> = {}
      const next = withCodeConnect({
        webpack(cfg, _ctx) {
          userTouched.ran = true
            ; (cfg.resolve as { alias: Record<string, string> }).alias['@user/lib'] = '/u/abs'
          return cfg
        },
      })
      const ctx = ctxFor({ dev: true, isServer: false })
      const config = next.webpack!({ resolve: { alias: {} } }, ctx)
      expect(userTouched.ran).toBe(true)
      // Our alias was applied AFTER user's webpack() ran, so both should be present.
      expect(config.resolve!.alias!['@user/lib']).toBe('/u/abs')
      expect(config.resolve!.alias!['@figma/code-connect/register']).toBeDefined()
    })

    it('does not push any plugin onto config.plugins (no auto-inject)', () => {
      const next = withCodeConnect()
      const ctx = ctxFor({ dev: true, isServer: false })
      const config = next.webpack!({ resolve: { alias: {} } } as never, ctx) as never as {
        plugins?: unknown[]
      }
      expect(config.plugins).toBeUndefined()
    })
  })

  describe('turbopack pipeline', () => {
    it('adds the runtime to experimental.turbo.resolveAlias and preserves existing entries', () => {
      const next = withCodeConnect({
        experimental: {
          turbo: { resolveAlias: { '@kept/alias': '/k/abs' } },
        },
      })
      expect(next.experimental!.turbo!.resolveAlias!['@kept/alias']).toBe('/k/abs')
      expect(next.experimental!.turbo!.resolveAlias!['@figma/code-connect/register']).toMatch(
        /runtime\.js$/,
      )
    })
  })

  describe('enabled resolution', () => {
    describe('enabled: undefined (default — gate on NODE_ENV)', () => {
      it('is enabled when NODE_ENV !== "production"', () => {
        withNodeEnv('development', () => {
          const next = withCodeConnect()
          expect(next.experimental!.turbo!.resolveAlias!['@figma/code-connect/register']).toBeDefined()
        })
      })

      it('is disabled when NODE_ENV === "production"', () => {
        withNodeEnv('production', () => {
          const userConfig = { experimental: { something: 'kept' } as never }
          const result = withCodeConnect(userConfig)
          // Same reference — no wrap.
          expect(result).toBe(userConfig)
          expect((result.experimental as { turbo?: unknown }).turbo).toBeUndefined()
        })
      })

      it('is enabled when NODE_ENV is unset (default to dev)', () => {
        withNodeEnv(undefined, () => {
          const next = withCodeConnect()
          expect(next.experimental!.turbo!.resolveAlias!['@figma/code-connect/register']).toBeDefined()
        })
      })
    })

    describe('enabled: true (force on)', () => {
      it('overrides the production default and stays enabled in production', () => {
        withNodeEnv('production', () => {
          const next = withCodeConnect({}, { enabled: true })
          expect(next.experimental!.turbo!.resolveAlias!['@figma/code-connect/register']).toBeDefined()
          expect(typeof next.webpack).toBe('function')
        })
      })
    })

    describe('enabled: false (force off — hard short-circuit)', () => {
      it('returns the user nextConfig untouched (no webpack wrap, no experimental.turbo)', () => {
        withNodeEnv('development', () => {
          const userConfig = {
            webpack: undefined,
            experimental: { something: 'kept' } as never,
          }
          const result = withCodeConnect(userConfig, { enabled: false })
          expect(result).toBe(userConfig)
          expect((result.experimental as { turbo?: unknown }).turbo).toBeUndefined()
        })
      })

      it('does not wrap the user-supplied webpack() function', () => {
        const userWebpack = jest.fn(
          (cfg: { resolve?: { alias?: Record<string, string> } }) => cfg,
        )
        const result = withCodeConnect({ webpack: userWebpack }, { enabled: false })
        expect(result.webpack).toBe(userWebpack)
      })
    })
  })
})
