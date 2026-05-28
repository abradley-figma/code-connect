import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import {
  CodeConnectReactConfig,
  discoverFilesByGlob,
  getGitRepoDefaultBranchName,
  getRemoteFileUrl,
  isTemplateFilePath,
  mapImportPath,
  mapImportSpecifier,
  resolveTemplateGlobs,
} from '../project'

// Locally-duplicated copies of the templates-only default globs
// `resolveTemplateGlobs` produces when `isTemplatesOnlyCLI=true` and no
// `config.include` / `config.exclude` is set. Kept inline (rather than
// imported from `../project`) so `connect/project.ts` doesn't need to
// export these — every other consumer (`compile/compiler.ts`, etc.)
// calls `resolveTemplateGlobs` directly instead of reaching for the
// constants. If the defaults ever change, both the inline literal in
// `resolveTemplateGlobs` AND these copies must update together — the
// `returns the templates-only defaults` test is the pin that catches
// drift.
const TEMPLATES_ONLY_DEFAULT_INCLUDE_GLOBS = [
  '**/*.figma.ts',
  '**/*.figma.js',
  '**/*.figma.template.ts',
  '**/*.figma.template.js',
  '**/*.figma.batch.json',
]
const TEMPLATES_ONLY_DEFAULT_EXCLUDE_GLOBS = ['node_modules/**']

describe('Project helper functions', () => {
  function getConfig(importPaths: {}): CodeConnectReactConfig {
    return {
      parser: 'react',
      ...importPaths,
    }
  }

  describe('importPath mappings', () => {
    it('Matches a simple import path', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/button.tsx',
        getConfig({ importPaths: { 'src/button.tsx': '@ui/button' } }),
      )
      expect(mapped).toEqual('@ui/button')
    })

    it('Matches a wildcard import path', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/button.tsx',
        getConfig({ importPaths: { 'src/*': '@ui' } }),
      )
      expect(mapped).toEqual('@ui')
    })

    it('Matches a wildcard import path with a wildcard output path', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/button.tsx',
        getConfig({ importPaths: { 'src/*': '@ui/*' } }),
      )
      expect(mapped).toEqual('@ui/button')
    })

    it('Matches a wildcard import path with a nested directory', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/components/button.tsx',
        getConfig({ importPaths: { 'src/*': '@ui' } }),
      )
      expect(mapped).toEqual('@ui')
    })

    it('Matches a wildcard import path and output path with a nested directory', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/components/button.tsx',
        getConfig({ importPaths: { 'src/*': '@ui/*' } }),
      )
      expect(mapped).toEqual('@ui/button')
    })

    it('Passing only a wildcard matches any import', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/components/button.tsx',
        getConfig({ importPaths: { '*': '@ui' } }),
      )
      expect(mapped).toEqual('@ui')
    })

    it('Returns null for non-matching paths', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/button.tsx',
        getConfig({ importPaths: { 'src/components/*': '@ui' } }),
      )
      expect(mapped).toBeNull()
    })

    it('Should pick the first match if there are multiple mappings', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/icons/icon.tsx',
        getConfig({ importPaths: { 'icons/*': '@ui/icons', 'src/*': '@ui' } }),
      )
      expect(mapped).toEqual('@ui/icons')
    })

    it('Uses filename for index files (use mapImportSpecifier for better results)', () => {
      // Note: mapImportPath uses the resolved file path, so index.ts files return 'index'.
      // For better handling of path aliases, use mapImportSpecifier with the original specifier.
      const mapped = mapImportPath(
        '/Users/test/app/src/AlertTitle/index.ts',
        getConfig({ importPaths: { 'src/*': '@acme/package/*' } }),
      )
      expect(mapped).toEqual('@acme/package/index')
    })

    it('Uses filename for nested index files', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/components/Button/index.tsx',
        getConfig({ importPaths: { 'src/*': '@ui/*' } }),
      )
      expect(mapped).toEqual('@ui/index')
    })

    it('Uses filename when file is not an index file', () => {
      const mapped = mapImportPath(
        '/Users/test/app/src/AlertTitle/AlertTitle.tsx',
        getConfig({ importPaths: { 'src/*': '@acme/package/*' } }),
      )
      expect(mapped).toEqual('@acme/package/AlertTitle')
    })
  })

  describe('importSpecifier mappings', () => {
    it('Transforms path alias with wildcard to package path', () => {
      const mapped = mapImportSpecifier(
        '@/AlertTitle',
        getConfig({ importPaths: { '@/*': '@acme/package/*' } }),
      )
      expect(mapped).toEqual('@acme/package/AlertTitle')
    })

    it('Transforms nested path alias to package path', () => {
      const mapped = mapImportSpecifier(
        '@/components/Button',
        getConfig({ importPaths: { '@/*': '@ui/*' } }),
      )
      expect(mapped).toEqual('@ui/components/Button')
    })

    it('Handles exact match without wildcard', () => {
      const mapped = mapImportSpecifier(
        '@/Button',
        getConfig({ importPaths: { '@/Button': '@acme/Button' } }),
      )
      expect(mapped).toEqual('@acme/Button')
    })

    it('Handles wildcard replacement without output wildcard', () => {
      const mapped = mapImportSpecifier(
        '@/components/Button',
        getConfig({ importPaths: { '@/*': '@ui' } }),
      )
      expect(mapped).toEqual('@ui')
    })

    it('Returns null for non-matching specifiers', () => {
      const mapped = mapImportSpecifier(
        './Button',
        getConfig({ importPaths: { '@/*': '@acme/package/*' } }),
      )
      expect(mapped).toBeNull()
    })

    it('Matches first pattern when multiple patterns could match', () => {
      const mapped = mapImportSpecifier(
        '@/icons/icon',
        getConfig({ importPaths: { '@/icons/*': '@ui/icons/*', '@/*': '@ui/*' } }),
      )
      expect(mapped).toEqual('@ui/icons/icon')
    })

    it('Returns null when no importPaths configured', () => {
      const mapped = mapImportSpecifier('@/Button', getConfig({}))
      expect(mapped).toBeNull()
    })

    it('Handles special regex characters in pattern', () => {
      const mapped = mapImportSpecifier(
        '@scope/package/Button',
        getConfig({ importPaths: { '@scope/package/*': '@acme/*' } }),
      )
      expect(mapped).toEqual('@acme/Button')
    })
  })

  describe('getRemoteFileUrl', () => {
    it('handles git repo urls', () => {
      expect(getRemoteFileUrl('/path/file.ts', 'git@github.com:myorg/myrepo.git')).toBe(
        'https://github.com/myorg/myrepo/blob/master/path/file.ts',
      )
    })

    it('handles https repo urls', () => {
      expect(getRemoteFileUrl('/path/file.ts', 'https://github.com/myorg/myrepo.git')).toBe(
        'https://github.com/myorg/myrepo/blob/master/path/file.ts',
      )
    })

    it('handles gitlab repo urls', () => {
      expect(getRemoteFileUrl('/path/file.ts', 'git@gitlab.com:myorg/myrepo.git')).toBe(
        'https://gitlab.com/myorg/myrepo/-/blob/master/path/file.ts',
      )
    })

    it('handles Bitbucket repo urls', () => {
      expect(getRemoteFileUrl('/path/file.ts', 'git@bitbucket.org:myorg/myrepo.git')).toBe(
        'https://bitbucket.org/myorg/myrepo/src/master/path/file.ts',
      )
    })

    it('handles Azure repo urls', () => {
      expect(
        getRemoteFileUrl('/path/file.ts', 'git@ssh.dev.azure.com:v3/myorg/myrepo/myrepo'),
      ).toBe('https://dev.azure.com/myorg/myrepo/_git/myrepo?path=/path/file.ts&branch=master')
    })

    it('handles Azure repo urls with https', () => {
      expect(
        getRemoteFileUrl('/path/file.ts', 'https://myorg@dev.azure.com/myorg/myrepo/_git/myrepo'),
      ).toBe('https://dev.azure.com/myorg/myrepo/_git/myrepo?path=/path/file.ts&branch=master')
    })

    it('assumes GitHub-like structure for unknown urls', () => {
      expect(
        getRemoteFileUrl('/path/file.ts', 'https://my-custom-domain.com/myorg/myrepo.git'),
      ).toBe('https://my-custom-domain.com/myorg/myrepo/blob/master/path/file.ts')
    })

    it('uses explicit defaultBranch when provided', () => {
      expect(
        getRemoteFileUrl('/path/file.ts', 'https://github.com/myorg/myrepo.git', 'release'),
      ).toBe('https://github.com/myorg/myrepo/blob/release/path/file.ts')
    })
  })

  describe('getGitRepoDefaultBranchName', () => {
    let tmpDir: string

    // Minimal git identity so operations don't fail with "Please tell me who you are"
    const gitEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
    }

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-connect-branch-test-'))
      spawnSync('git', ['init'], { cwd: tmpDir, env: gitEnv })
      spawnSync('git', ['remote', 'add', 'origin', 'https://example.com/repo.git'], {
        cwd: tmpDir,
        env: gitEnv,
      })
    })

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })

    it('returns configDefaultBranch without inspecting the repo', () => {
      // Pass a non-existent path to confirm the config value short-circuits
      expect(getGitRepoDefaultBranchName('/does/not/exist', 'release')).toBe('release')
    })

    it('detects an arbitrary default branch via symbolic-ref', () => {
      spawnSync(
        'git',
        ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop'],
        { cwd: tmpDir, env: gitEnv },
      )
      expect(getGitRepoDefaultBranchName(tmpDir)).toBe('develop')
    })

    it('falls back to "main" from branch list when symbolic-ref is not set', () => {
      // Write a fake remote tracking ref so `git branch -r` lists origin/main
      fs.mkdirSync(path.join(tmpDir, '.git', 'refs', 'remotes', 'origin'), { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, '.git', 'refs', 'remotes', 'origin', 'main'),
        '0000000000000000000000000000000000000001\n',
      )
      expect(getGitRepoDefaultBranchName(tmpDir)).toBe('main')
    })

    it('falls back to "master" when no branch info is available', () => {
      expect(getGitRepoDefaultBranchName(tmpDir)).toBe('master')
    })
  })

  describe('resolveTemplateGlobs', () => {
    // Pure-function helper extracted from `getProjectInfoFromConfig` so
    // both the connect CLI commands (publish, parse) and the compile
    // pipeline (bundler adapters) share the same include / exclude
    // resolution rules.
    it('returns the templates-only defaults when isTemplatesOnlyCLI=true and config is empty', () => {
      expect(resolveTemplateGlobs({}, true)).toEqual({
        include: TEMPLATES_ONLY_DEFAULT_INCLUDE_GLOBS,
        exclude: TEMPLATES_ONLY_DEFAULT_EXCLUDE_GLOBS,
      })
    })

    it('lets config.include override the default include in templates-only mode', () => {
      const { include } = resolveTemplateGlobs({ include: ['**/*.figma.js'] }, true)
      expect(include).toEqual(['**/*.figma.js'])
    })

    it('layers config.exclude on top of the templates-only default exclude', () => {
      const { exclude } = resolveTemplateGlobs({ exclude: ['vendored/**'] }, true)
      expect(exclude).toEqual(['vendored/**', ...TEMPLATES_ONLY_DEFAULT_EXCLUDE_GLOBS])
    })

    it('falls back to parser-specific defaults when isTemplatesOnlyCLI=false', () => {
      // React parser maps to the parser-specific include glob set
      // (covering .tsx / .jsx). Templates-only defaults are not used.
      const { include, exclude } = resolveTemplateGlobs({ parser: 'react' }, false)
      expect(include).toBeDefined()
      expect(include).not.toEqual(TEMPLATES_ONLY_DEFAULT_INCLUDE_GLOBS)
      expect(exclude).toEqual(['node_modules/**'])
    })

    it('returns include=undefined for a parserless non-templates-only config (caller is responsible for the error)', () => {
      // `getProjectInfoFromConfig` exits with an error in this case;
      // the pure helper just returns undefined so callers can decide.
      const { include } = resolveTemplateGlobs({}, false)
      expect(include).toBeUndefined()
    })
  })

  describe('isTemplateFilePath', () => {
    // Predicate used by compile's HMR path to decide if a file change
    // should trigger a re-parse. Same matching semantics as the full
    // `discoverFilesByGlob` invocation, but no I/O — safe to call on
    // every file save.
    const SUPPORTED_EXTENSIONS = [
      'figma.ts',
      'figma.js',
      'figma.template.ts',
      'figma.template.js',
    ] as const

    const UNSUPPORTED_FILENAMES = [
      'Button.ts',
      'Button.tsx',
      'Button.js',
      'Button.figma.json',
      'figma.ts',
      'Button.figma.md',
      'README.md',
    ]

    const isTemplate = (relPath: string) =>
      isTemplateFilePath(
        relPath,
        [...TEMPLATES_ONLY_DEFAULT_INCLUDE_GLOBS],
        [...TEMPLATES_ONLY_DEFAULT_EXCLUDE_GLOBS],
      )

    it("returns true for every extension in connect's templates-only include defaults", () => {
      for (const ext of SUPPORTED_EXTENSIONS) {
        expect(isTemplate(`src/Button.${ext}`)).toBe(true)
      }
      expect(isTemplate('src/icons.figma.batch.json')).toBe(true)
    })

    it("returns false for .figma.tsx / .figma.jsx (not in connect's templates-only defaults)", () => {
      expect(isTemplate('src/Button.figma.tsx')).toBe(false)
      expect(isTemplate('src/Button.figma.jsx')).toBe(false)
      expect(isTemplate('src/Button.figma.template.tsx')).toBe(false)
      expect(isTemplate('src/Button.figma.template.jsx')).toBe(false)
    })

    it('returns false for non-template extensions', () => {
      for (const name of UNSUPPORTED_FILENAMES) {
        expect(isTemplate(`src/${name}`)).toBe(false)
      }
    })

    it('returns false for relative paths that escape the project root', () => {
      expect(isTemplate('../Button.figma.ts')).toBe(false)
    })

    it('returns false when handed an absolute path (caller must relativize first)', () => {
      // The compiler always calls `normalizeRelativePath` before
      // invoking this predicate. An absolute path slipping through
      // would otherwise match `**/*.figma.ts` — pin the guard.
      expect(isTemplate('/proj/src/Button.figma.ts')).toBe(false)
    })

    it('returns false for files inside node_modules (the templates-only default exclude)', () => {
      expect(isTemplate('node_modules/pkg/X.figma.ts')).toBe(false)
    })

    it('honors caller-supplied include globs (e.g. when figma.config.json widens them)', () => {
      // When the user's `figma.config.json#codeConnect.include` adds
      // `.figma.tsx`, the predicate must match it too. The compiler
      // passes the same resolved globs `discoverFilesByGlob` ran with
      // (cached on `compiler.ts` as `resolvedIncludeGlobs` /
      // `resolvedExcludeGlobs`).
      const include = [...TEMPLATES_ONLY_DEFAULT_INCLUDE_GLOBS, '**/*.figma.tsx']
      const exclude = [...TEMPLATES_ONLY_DEFAULT_EXCLUDE_GLOBS]
      expect(isTemplateFilePath('src/Button.figma.tsx', include, exclude)).toBe(true)
    })

    it('honors caller-supplied exclude globs (e.g. when figma.config.json adds dist/)', () => {
      const include = [...TEMPLATES_ONLY_DEFAULT_INCLUDE_GLOBS]
      const exclude = [...TEMPLATES_ONLY_DEFAULT_EXCLUDE_GLOBS, 'dist/**']
      expect(isTemplateFilePath('dist/Button.figma.ts', include, exclude)).toBe(false)
      expect(isTemplateFilePath('src/Button.figma.ts', include, exclude)).toBe(true)
    })
  })

  describe('discoverFilesByGlob (on disk)', () => {
    // Pin the on-disk side of the connect-owned discovery contract. The
    // compile pipeline (cli/src/compile/compiler.ts#build) calls this
    // directly with the resolved templates-only globs, so the
    // dedup/sort/POSIX-normalize behavior pinned here is what feeds the
    // compiler's `discoveredTemplateFiles` set and HMR predicate cache.
    //
    // The matching-rule side (which globs match which paths) is covered
    // by `resolveTemplateGlobs` + `isTemplateFilePath` above — we only
    // exercise the disk-walk + return-shape contract here.
    function makeRoot(files: string[]): string {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-discover-'))
      for (const rel of files) {
        const full = path.join(root, rel)
        fs.mkdirSync(path.dirname(full), { recursive: true })
        fs.writeFileSync(full, 'export const x = 1\n', 'utf8')
      }
      return root
    }

    it('returns sorted, deduplicated, absolute, POSIX-normalized paths', async () => {
      // Pin the four-part return contract — the compiler relies on all
      // of these (descriptor store keys are POSIX-normalized, the
      // discovered-file Set is order-preserving so the consumer sees a
      // sorted list, dedup means overlapping globs don't double-count).
      const root = makeRoot([
        'src/b/B.figma.ts',
        'src/a/A.figma.ts',
        'src/c/C.figma.ts',
      ])
      try {
        // Two overlapping globs cover the same files — dedup proves the
        // Set in `discoverFilesByGlob` collapses them.
        const found = await discoverFilesByGlob(
          root,
          ['**/*.figma.ts', '**/*.figma.{ts,js}'],
          ['node_modules/**'],
        )
        expect(found).toEqual([
          `${root}/src/a/A.figma.ts`,
          `${root}/src/b/B.figma.ts`,
          `${root}/src/c/C.figma.ts`,
        ])
        // Every entry must be POSIX-shaped — no backslashes leak even
        // on POSIX (the helper normalizes unconditionally so Windows
        // builds get the same canonical form).
        for (const f of found) expect(f).not.toContain('\\')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('excludes node_modules via the supplied exclude globs', async () => {
      const root = makeRoot([
        'src/Button.figma.ts',
        'node_modules/pkg/Junk.figma.ts',
      ])
      try {
        const found = await discoverFilesByGlob(
          root,
          ['**/*.figma.ts'],
          ['node_modules/**'],
        )
        expect(found).toEqual([`${root}/src/Button.figma.ts`])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('skips dot-prefixed directories via glob default `dot: false` (not via excludes)', async () => {
      // The skip happens inside `glob` itself before the supplied
      // exclude list ever runs. Pinned here so it doesn't silently flip
      // if `discoverFilesByGlob` ever sets `dot: true` — that would
      // change which files Vite / Webpack pick up on a clean install.
      const root = makeRoot([
        'src/Button.figma.ts',
        '.next/Junk.figma.ts',
        '.cache/Junk.figma.ts',
      ])
      try {
        const found = await discoverFilesByGlob(
          root,
          ['**/*.figma.ts'],
          ['node_modules/**'],
        )
        expect(found).toEqual([`${root}/src/Button.figma.ts`])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns an empty array when nothing matches', async () => {
      const root = makeRoot(['src/Plain.ts', 'README.md'])
      try {
        const found = await discoverFilesByGlob(
          root,
          ['**/*.figma.ts'],
          ['node_modules/**'],
        )
        expect(found).toEqual([])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it("matches resolveTemplateGlobs's templates-only defaults end-to-end", async () => {
      // Wiring test — feed the helpers together exactly the way
      // `cli/src/compile/compiler.ts#build` does, and confirm we get
      // every templates-only extension back. If either side drifts,
      // this test fails before any compile consumer notices.
      const root = makeRoot([
        'src/A.figma.ts',
        'src/B.figma.js',
        'src/C.figma.template.ts',
        'src/D.figma.template.js',
        'src/E.figma.batch.json',
        'src/Skip.figma.tsx', // not in templates-only defaults
        'node_modules/pkg/X.figma.ts',
      ])
      try {
        const { include, exclude } = resolveTemplateGlobs({}, true)
        const found = await discoverFilesByGlob(root, include!, exclude)
        expect(found).toEqual(
          [
            `${root}/src/A.figma.ts`,
            `${root}/src/B.figma.js`,
            `${root}/src/C.figma.template.ts`,
            `${root}/src/D.figma.template.js`,
            `${root}/src/E.figma.batch.json`,
          ].sort(),
        )
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
