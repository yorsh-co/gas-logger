# Plan: Caller-supplied spreadsheet (drop the Sheets scope from every consumer)

Branch: feature/sheet-scope · Base: develop

## Goal

Apps Script works out OAuth scopes by scanning code for service names. `src/gas-logger.class.ts:148-151` names `SpreadsheetApp`, so every project that bundles gas-logger asks for a Sheets scope, even when it never logs to a sheet. After this change the shipped source names no document service. The consumer passes the spreadsheet in (`spreadsheet`: an object or a lazy factory), so the scope comes only from the consumer's own `SpreadsheetApp` call. Success: the new `test/scopes.test.ts` passes, `grep -rE '\bSpreadsheetApp\b' src` finds nothing, the sheet sink works with an object and with a factory, and `npm run check` passes.

## Items

- feature (breaking, 2.0.0): `sheetConfig.spreadsheet` accepts a Spreadsheet or a factory; remove `spreadsheetUrl`, `spreadsheetId` and `useActiveSpreadsheet`. Phases 1–3

## Constraints & decisions

- Accept an object or a factory (user decision). 1.x already accepts a `spreadsheet` object, which the handoff missed, so those users don't have to change anything. Only users of url, id or active-spreadsheet have to migrate.
- Go straight to 2.0.0 with no 1.4.0 deprecation (user decision). Any deprecated path would still name `SpreadsheetApp`.
- Scan `src/` through `ts.transpileModule`, as gas-config's `test/scopes.test.ts` does, not `dist/` as the handoff says. `dist/` is gitignored and missing on a fresh clone, and transpiling drops the type-only references, so JSDoc mentioning `SpreadsheetApp` (in `.d.ts`/type files) is fine.
- Tell the two forms apart with `typeof spreadsheet === 'function'`; it is a factory if it is a function, otherwise an object.
- A factory that returns `null` or throws goes through the existing `_getSheet` catch path: one `console.error`, then the sink is disabled for the execution. The factory runs once per execution, because the result is cached on the sink, which child loggers share.
- Removed options throw a migration error at construction, so 1.x configs fail loudly. `sheetConfig: {}` throws now.
- Leave `package.json` `gasDevConfig.gasTest.scopes` unchanged, because the gas-test suite itself calls `SpreadsheetApp`.
- Don't bump the version or cut a release in this branch. Record the change under `## [Unreleased]` with Breaking/Fixed sections, and do the 2.0.0 bump in `git flow release`.

## Phases

### Phase 1: Spreadsheet object or factory; remove the named-service sources — [x] done

- Files: `test/scopes.test.ts` (new), `src/gas-logger.types.ts`, `src/gas-logger.class.ts`, `test/gas-logger.test.ts`, `test/mocks.ts`, `test/harness.ts`
- Steps:
  1. Add `test/scopes.test.ts`, ported from `../gas-config/test/scopes.test.ts`: FORBIDDEN = `SpreadsheetApp`, `DocumentApp`, `SlidesApp`, `FormApp`. Scan every `.ts` under `src/`, excluding `src/internal/` and `*.d.ts`, after `ts.transpileModule`. The sanity test asserts that `src/gas-logger.class.ts` is in the scanned list. Import `ROOT` from `./harness`. Confirm it fails on the current code.
  2. `src/gas-logger.types.ts`: replace `GasLoggerSheetConfig` with the shape below, with JSDoc on both fields:
     `spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet | (() => GoogleAppsScript.Spreadsheet.Spreadsheet | null);`
     `sheetName?: string; /** @default 'gas-log' */`
     The JSDoc on `spreadsheet` explains that a factory is called on the first write.
  3. `src/gas-logger.class.ts`, `_validateSheetConfig`:
     - If any of `spreadsheetUrl`, `spreadsheetId` or `useActiveSpreadsheet` is a key of the config (`in` check), throw: `[GasLogger] "<names>" was removed in 2.0.0. Pass "spreadsheet" instead: a Spreadsheet, or a function returning one. See the README "Migrating from 1.x" section.` The message must not contain the service name (see the risk note below).
     - Otherwise, if `spreadsheet` is neither an object (non-null) nor a function, throw `[GasLogger] "sheetConfig.spreadsheet" is required: pass a Spreadsheet, or a function returning one.`
     - Update the JSDoc.
  4. `_resolveSpreadsheet`: if `spreadsheet` is a function, call it, otherwise use it as is. If the result is null or undefined, throw `[GasLogger] The "spreadsheet" function returned no spreadsheet.` Remove all `SpreadsheetApp` references and update the JSDoc.
  5. `test/gas-logger.test.ts`:
     - Replace every `useActiveSpreadsheet: true` with `spreadsheet: mocks.activeSpreadsheet` (or a factory where laziness is tested).
     - Replace the url/id/active/multiple-source/`useActiveSpreadsheet: false` tests with:
       - The object form writes rows.
       - The factory is not called at construction, is called on the first write, and is called only once across several writes and child loggers.
       - A factory returning `null`: one `console.error`, the sink is disabled, later writes don't call the factory again.
       - A factory that throws: the same.
       - Each removed option throws the migration error.
       - `sheetConfig: {}` and an invalid `spreadsheet` (for example a string) throw.
     - Adapt the source-eval test near line 1175 the same way.
  6. `test/mocks.ts` / `test/harness.ts`: remove the `SpreadsheetApp` fake and its injection if nothing uses it any more; keep `activeSpreadsheet` (`FakeSpreadsheet`).
- Risk: string literals survive transpiling, and the Apps Script scanner may read them, so no message may name a forbidden service. The scopes test enforces this.
- Done when: `npx vitest run` passes; `grep -rE '\bSpreadsheetApp\b' src` finds nothing; `npm run typecheck` passes.
- Review: deep. It changes the OAuth scope surface and the public config contract.

### Phase 2: Peer types and live Apps Script tests — [x] done

- Files: `peer/gas-logger.peer.types.d.ts`, `gas-test/gas-logger.ts`
- Steps:
  1. Mirror the new `GasLoggerSheetConfig` (with its JSDoc) in `peer/gas-logger.peer.types.d.ts`, and remove the three removed fields.
  2. `gas-test/gas-logger.ts`: keep the existing object-form tests. Add one `test('spreadsheet factory', …)` that passes `spreadsheet: () => spreadsheet`, logs twice, asserts the factory was called once and both rows were written, and cleans up the sheet like its neighbours.
- Done when: `npm run typecheck && npm run lint` passes. Running the live suite (`npm run test:gas`) needs clasp credentials; report it to the user as not run, don't run it here.
- Review: standard

### Phase 3: README — [ ] todo

- Files: `README.md`
- Steps:
  1. Change the Features bullet (line ~20) and the Example Usage snippet (line ~36) to `spreadsheet: () => SpreadsheetApp.getActiveSpreadsheet()`.
  2. Requirements (line ~50): the consumer supplies the spreadsheet.
  3. Rewrite "Log to a Sheet" (line ~233): describe the object and factory forms, explain why the factory keeps things lazy (global-scope loggers, `doGet` with no active spreadsheet), give the null/throw behaviour and the construction-time validation.
  4. Replace the remaining `useActiveSpreadsheet: true` examples (lines ~257, 270, 284) with the factory form.
  5. Add a "Scopes" subsection under Project Details: the library names no Google document service; the Sheets scope comes from the consumer's own `SpreadsheetApp` call; `/** @OnlyCurrentDoc */` narrows it to `spreadsheets.currentonly`.
  6. Add a "Migrating from 1.x" subsection with before/after for url, id and active-spreadsheet.
  7. Update the line ~345 note about the `SpreadsheetApp` fake if Phase 1 removed it.
- Done when: `npm run format:check` passes; `grep -nE 'spreadsheetUrl|spreadsheetId|useActiveSpreadsheet' README.md` matches only the migration section.
- Review: standard

## Log

- Phase 1: done. Deep review fixes: a primitive `sheetConfig` now throws the `[GasLogger]` error; the message says "were" for several removed options. The CHANGELOG entry is deferred to final review.
- Phase 2: done. `npm run test:gas` not run (needs clasp credentials), so the new factory test hasn't run on Apps Script. Its sheet is cleaned up through the prefix, like its neighbours.

## Open questions

- Setup requires a clean tree. `SHEET-SCOPE-HANDOFF.md` is untracked, so move it out of the repo (or delete it) before setup runs.
- Downstream gas-config work (vendored peer types, peer range `^2.0.0`, scanning bundled peers, re-running manual check 1, the interim README note) is out of scope here. Follow up there after 2.0.0 ships.
