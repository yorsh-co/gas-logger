# Changelog

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
