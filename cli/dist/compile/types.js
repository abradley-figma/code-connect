"use strict";
/**
 * All shared type declarations for the compiler core. Three concentric
 * layers, each addressed by a different consumer:
 *
 *  1. **Public adapter API** — `CreateCompilerOptions`, `CodeConnectCompiler`,
 *     `CodeConnectBuildResult`, `CodeConnectUpdateFileResult`. These are
 *     re-exported from `./index.ts` and form the contract every bundler
 *     adapter codes against.
 *
 *  2. **Public on-the-wire types** — `PropDescriptor` (a discriminated union
 *     across `string` / `number` / `boolean` / `enum` / `reference` /
 *     `slot` / `color` / `image` / `easing` / `vector`),
 *     `ComponentDescriptor`, `ComponentDescriptors`, `CodeConnectManifest`.
 *     These describe the JSON the runtime shim ships to the browser.
 *
 *  3. **Browser-side global** — `FigmaCodeConnectApi` plus a `declare global`
 *     block that augments `Window` with `figmaCodeConnect`. The runtime
 *     shim (in `runtime.ts`) installs an implementation that satisfies
 *     this interface; the host environment reads it.
 *
 * Code Connect template files produce a subset of `PropDescriptor`
 * (`string`, `boolean`, `enum`, `reference`, `slot`). The other shapes
 * are reserved for forward compatibility — see each interface below for
 * notes on which fields the template parser does and doesn't populate.
 */
Object.defineProperty(exports, "__esModule", { value: true });
