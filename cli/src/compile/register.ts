/**
 * Empty fallback module that backs the `@figma/code-connect/register`
 * public subpath.
 *
 * Why this file exists
 * --------------------
 * Users add to their app's entry (e.g. `src/main.tsx`,
 * `pages/_app.tsx`, `app/layout.tsx`):
 *
 *     import '@figma/code-connect/register'
 *
 * to install `window.figmaCodeConnect.getComponentDescriptor` so
 * the host environment can read component-prop descriptors at runtime.
 * The bundler adapters (`@figma/code-connect/{vite,webpack,nextjs,esbuild}`)
 * and the headless `prepareCodeConnect` helper intercept this specifier
 * and route it to the GENERATED runtime shim populated with the project's
 * descriptors.
 *
 * This file is what the import resolves to in two cases:
 *
 *  1. **No bundler adapter is wired up** — the user added the manual
 *     import but didn't install one of our adapters. Falling back to
 *     this empty module means the import statement is a valid no-op
 *     instead of a build error; missing `window.figmaCodeConnect`
 *     surfaces clearly the first time something tries to read it.
 *
 *  2. **The adapter is configured with `enabled: false`** — typically
 *     because the user has gated the adapter on a "is this a dev
 *     build?" signal. In that case the adapter explicitly does NOT
 *     intercept the import, the import resolves through normal Node
 *     resolution to this file, and production bundles get a tree-
 *     shakeable empty module instead of a populated runtime full of
 *     component metadata.
 *
 * The empty `export {}` keeps this module a valid ES module under
 * `"type": "module"` packages and prevents TS from inferring it as a
 * script (which would shadow user globals on import).
 */
export { }
