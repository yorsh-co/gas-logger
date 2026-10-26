# Changelog

---

## [Unreleased]

### Fixed

- Resolve the sheet on the first write instead of in the constructor; access errors (bad id, no active spreadsheet, lock timeout) are reported once to `console.error` and disable the sheet sink for the execution instead of throwing from the logger
- Reuse a single default `gas-log` tab instead of creating `gas-log-0`, `gas-log-1`, ... on every new logger
- Create the log sheet inside the script lock and re-check for it after acquiring the lock, so concurrent first runs no longer fail on a duplicate sheet name
- Treat an empty `sheetConfig` as enabling the sheet sink on the active spreadsheet, and throw at construction for `useActiveSpreadsheet: false` without another source
- Correct the `_resolveSheet` JSDoc and a typo in the source validation docs

### Added

- Vitest test suite with in-memory Apps Script service mocks, covering current behaviour and documenting known defects as expected failures

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
