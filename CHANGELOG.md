# Changelog

---

## [1.3.0] - 2026-10-30

### Added

- Apps Script tests in `gas-test/`, run with gas-dev-config's `gas-test` (`npm run test:gas:build`, `npm run test:gas`)
- The release `package.json` carries `gasLibrary` load-order metadata for gas-dev-bundle, with gas-lock as a peer

### Changed

- Load order is read from `gasDevConfig.loadOrder` instead of being duplicated in the test harness
- Bumped gas-dev-config to ^1.4.0 and gas-dev-release to ^1.1.0

---

## [1.2.0] - 2026-10-28

### Added

- `lockService` option: any object exposing `withLock(scope, callback, options?)`, e.g. [`GasLock`](https://github.com/yorsh-co/gas-lock), through which sheet creation and buffered flushes take the script lock; the `GasLock` global is used automatically when it is loaded, resolved on each acquisition, else Apps Script's `LockService` as before

### Fixed

- A buffered flush or first sheet creation inside a caller's own script-lock section no longer ends that section early when GasLock is used; with raw `LockService`, locks are owned per execution and the nested release still ends the caller's section

### Changed

- Lint, TypeScript and Prettier configuration and the test loader come from [`gas-dev-config`](https://github.com/yorsh-co/gas-dev-config)
- Dependabot groups development dependencies weekly
- The vendored `GasLock` declaration is the canonical copy from gas-lock's `peer/`, at 1.1.0

---

## [1.1.1] - 2026-10-27

### Changed

- Releases are published with [`gas-dev-release`](https://github.com/yorsh-co/gas-dev-release) instead of `scripts/release.sh`, which adds a check that the `v<version>` tag is at `HEAD` and pushes the branch and tag atomically
- Tags use a `v` prefix: versions are tagged `vX.Y.Z` and releases `dist/vX.Y.Z`; the earlier plain tags were replaced
- Bump the transitive dev dependency `brace-expansion` to 5.0.12 to resolve high-severity DoS advisories reported by `npm audit`

---

## [1.1.0] - 2026-10-26

### Fixed

- Resolve the sheet on the first write instead of in the constructor; access errors (bad id, no active spreadsheet, lock timeout) are reported once to `console.error` and disable the sheet sink for the execution instead of throwing from the logger
- Reuse a single default `gas-log` tab instead of creating `gas-log-0`, `gas-log-1`, ... on every new logger
- Create the log sheet inside the script lock and re-check for it after acquiring the lock, so concurrent first runs no longer fail on a duplicate sheet name
- Treat an empty `sheetConfig` as enabling the sheet sink on the active spreadsheet, and throw at construction for `useActiveSpreadsheet: false` without another source
- Write buffered batches under the script lock, so concurrent flushes no longer overwrite each other's rows
- Add rows to the sheet when a batch doesn't fit, instead of failing when the sheet has no empty rows left
- Write a `bypassBufferLevels` entry together with any pending buffered rows in one locked batch, so the sheet keeps chronological order
- Report sheet write failures to `console.error` and drop the affected rows instead of throwing from the logger; the buffer is always cleared so a failed batch is never re-written
- Apply row banding and the bold header to the four log columns only, instead of every column in the sheet
- Correct the `_resolveSheet` JSDoc and a typo in the source validation docs
- Serialize `Error` values in meta (name, message, stack and own enumerable properties), `bigint` values as strings and circular references as `[Circular]`, for both the console and the sheet, instead of throwing or logging `{}`
- Store `message` and `meta_json` cells starting with `=`, `+`, `-` or `@` as text, so logged input can't inject sheet formulas
- Truncate `message` and `meta_json` cells to the 50,000 character cell limit, ending with `…[truncated]`; console output is not truncated
- Build the console payload so `message` and `level` can't be overridden by meta or bindings
- Emit `trace`, `debug` and `fatal` as a structured payload even without meta, so the real level is always present
- Stop shipping the empty `gas-logger.types.js` to the `dist` branch; the release script now excludes `*.types.js` and keeps the `.d.ts`
- Harden the release script: fail early on a dirty working tree, a missing or empty `dist/`, or an existing `dist/<version>` tag locally or on origin; sync with `origin/dist` (creating a local `dist` that tracks it, or fast-forwarding, and refusing to discard unpushed commits); exit with a clear message when there is nothing to release; push only the `dist` branch and the release tag instead of `--tags`

### Docs

- Fix the `filePushOrder` error example to name `GasLogger` and note that the paths must match where the files land in the pushed project
- Describe `bypassBufferLevels` as flushing the buffer together with pending rows instead of skipping it

### Added

- Vitest test suite with in-memory Apps Script service mocks

### Changed

- Hold the sheet, buffer and flush settings in a single sink object shared by a logger and its children, and build children with the constructor instead of `Object.create`
- ESLint config uses `defineConfig` from `eslint/config` and drops the stale `no-undef` comment
- `npm run typecheck` and ESLint also cover `test/` through `tsconfig.test.json`; `npm run check` runs the test suite

---

## [1.0.2] - 2026-08-06

### Fixed

- Clear the row buffer in place on flush, so child loggers sharing the parent's buffer no longer re-write rows that were already written to the sheet

### Changed

- Annotate the object created in `child(...)` as `GasLogger`, so field assignments are type-checked instead of passing through `Object.create`'s `any`

---

## [1.0.1] - 2026-08-06

### Fixed

- Set `child(...)` return type explicitly to `GasLogger`

### Docs

- Correct paths in `.clasp.json` `filePushOrder` example in README.md

---

## [1.0.0] - 2026-07-30

### Added

- `GasLogger` class with `trace`/`debug`/`info`/`warn`/`error`/`fatal` methods, filtered against a configurable minimum `level`
- Structured console output via `console.info`/`warn`/`error`, with a `jsonPayload` when `meta` is provided — `trace`/`fatal` have no dedicated console method, so they're emitted via `info`/`error`
- Optional Google Sheets sink (`sheetConfig`), resolving a spreadsheet from `spreadsheet`, `spreadsheetUrl`, `spreadsheetId`, or `useActiveSpreadsheet`, and auto-creating the target sheet with a frozen, bold header row and alternating row banding if it doesn't already exist
- Independent `sheetLevel` threshold (defaults to `level`), so console/Cloud Logging output and the sheet sink can be filtered at different minimum levels from the same logger
- Row buffering (`flushThreshold`) with `bypassBufferLevels` for levels that should write through immediately, plus a `flush()` method to write any remaining buffered rows
- Bound fields (`bindings`) merged into every log call's `meta`, and `child(bindings, overrides)` for creating child loggers that inherit and extend those bindings, optionally overriding `level`/`sheetLevel` for that child alone
- TypeScript source compiling to plain global-scope `.js` with matching `.d.ts` declarations — no bundler or build step required downstream
- Release pipeline (`scripts/release.sh`) publishing compiled `dist/*.js`/`.d.ts` plus README/LICENSE/CHANGELOG to a dedicated `dist` branch for `git subtree` consumption
- Project scaffolding: TypeScript, ESLint, and Prettier configuration; npm package manifest and scripts
