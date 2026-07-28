# gas-logger

[![Built with Google Apps Script](https://img.shields.io/badge/Built%20with-Google%20Apps%20Script-4285F4?logo=google&logoColor=white)](https://developers.google.com/apps-script)

## Structured logger for Google Apps Script, with an optional Google Sheets sink.

> The goal of this project is to give Apps Script projects a single leveled logger that writes structured, Cloud-Logging-friendly output to `console` and, optionally, appends the same entries to a Google Sheet for durable, queryable logs.

`gas-logger` provides a `GasLogger` class with the usual `trace`/`debug`/`info`/`warn`/`error`/`fatal` methods. Every call is emitted to the Apps Script `console` service; if a `sheetConfig` is supplied, the same entry is also written as a row to a spreadsheet — auto-creating and formatting the sheet on first use.

> **Disclaimer:**
> This project and [Yorsh](https://github.com/yorsh-co) are independent and are not affiliated with, endorsed by, or associated with Google LLC.

### Features

- Six log levels (`trace` < `debug` < `info` < `warn` < `error` < `fatal`) with a configurable minimum `level`
- Structured console output — feeds Cloud Logging with a severity and, when `meta` is present, a `jsonPayload`
- Optional Google Sheets sink: pass `spreadsheet`, `spreadsheetUrl`, `spreadsheetId`, or `useActiveSpreadsheet` in `sheetConfig` to also append each entry as a row
- Independent `sheetLevel` threshold — e.g. stay verbose in Cloud Logging while only writing `warn`+ to the sheet
- Auto-creates the target sheet if it doesn't exist yet, with a frozen, bold header row and alternating row banding
- Row buffering via `flushThreshold`, with `bypassBufferLevels` for levels (e.g. `error`, `fatal`) that should always write through immediately
- Child loggers (`logger.child(bindings, overrides)`) that merge bound fields into every subsequent call's `meta`, optionally scoped to their own `level`/`sheetLevel`
- Written in TypeScript; ships compiled `.js` plus matching `.d.ts` files, so no build step is required to consume it, TS or not
- No external dependencies beyond built-in Apps Script services

### Example Usage

```js
const logger = new GasLogger({
  level: 'info',
  sheetConfig: { useActiveSpreadsheet: true, sheetName: 'Logs' },
  flushThreshold: 25,
  bypassBufferLevels: ['error', 'fatal'],
});

logger.info('User signed in', { email: 'jane@example.com' });
logger.error('Failed to save record', { recordId: 42 });

// ...at the end of the request/execution
logger.flush();
```

## Requirements

`gas-logger` has no required peer packages. If `sheetConfig` is used, the running script needs access to the target spreadsheet (via the Sheets service, same as any other `SpreadsheetApp` call).

## Quick Start

It is recommended to use `gas-logger` together with [Google's `clasp` CLI](https://github.com/google/clasp) for local Apps Script development and git-based workflows. See [Setup instructions with `clasp`](#setup-instructions-with-clasp) for more information.

#### 1. Add the library to your Apps Script project

This repository publishes compiled output on a dedicated `dist` branch — subtree from `dist`, not `main`, so no TypeScript/ESLint tooling lands in your project.

```bash
git subtree add \
  --prefix=src/lib/gas-logger \
  https://github.com/yorsh-co/gas-logger.git \
  dist \
  --squash
```

This creates:

```txt
src/lib/gas-logger/
```

#### 2. Declare a `GasLogger` instance and use it

```js
const logger = new GasLogger();

logger.info('Script started');
```

## Setup instructions with `clasp`

`gas-logger` works best with [Google's `clasp` CLI](https://github.com/google/clasp) for local Apps Script development and git-based workflows.

#### 1. Install clasp

```bash
npm install -g @google/clasp
```

#### 2. Enable the [Apps Script API](https://script.google.com/home/usersettings)

#### 3. Login to Google Apps Script

```bash
clasp login
```

#### 4. Clone or create your Apps Script project

Clone an existing project:

```bash
clasp clone <script-id>
```

or create a new one:

```bash
clasp create --type standalone
```

#### 5. Import `gas-logger`

```bash
git subtree add \
  --prefix=src/lib/gas-logger \
  https://github.com/yorsh-co/gas-logger.git \
  dist \
  --squash
```

This creates:

```txt
src/lib/gas-logger/
```

#### 6. Push local files to Apps Script

```bash
clasp push
```

> **Note:**
> `GasLogger` doesn't extend or reference any other class at file-load time, so — unlike `gas-webapp` — it has no file push order requirement relative to your other files.

#### 7. Declare a `GasLogger` instance and use it

```js
const logger = new GasLogger();

logger.info('Script started');
```

## Basic Usage

### Create a `GasLogger` instance

```js
const logger = new GasLogger({
  level: 'info', // default: 'info'
});
```

### Log at each level

```js
logger.trace('Verbose trace message');
logger.debug('Debug details', { step: 'validate' });
logger.info('User signed in', { email: 'jane@example.com' });
logger.warn('Deprecated field used', { field: 'legacyId' });
logger.error('Failed to save record', { recordId: 42 });
logger.fatal('Unrecoverable state', { reason: 'quota exceeded' });
```

Only calls at or above the configured `level` are emitted — with the default `'info'` level, `trace` and `debug` calls are silently dropped. `level` gates console output; the sheet sink (if configured) is gated by `sheetLevel` instead — see [Different Levels per Sink](#different-levels-per-sink).

### Log to a Sheet

```js
const logger = new GasLogger({
  sheetConfig: {
    spreadsheetId: '1AbC...xyz',
    sheetName: 'App Logs',
  },
});
```

Pass exactly one of `spreadsheet`, `spreadsheetUrl`, `spreadsheetId`, or `useActiveSpreadsheet` in `sheetConfig` — omitting all four defaults to `useActiveSpreadsheet`. If `sheetName` doesn't already exist, `GasLogger` creates it with a frozen, bold header row (`timestamp`, `level`, `message`, `meta_json`) and alternating row banding.

> **Note:**
> Omitting `sheetConfig` entirely disables the sheet sink — logs still go to `console`.

### Different Levels per Sink

```js
const logger = new GasLogger({
  level: 'info', // console/Cloud Logging threshold
  sheetLevel: 'warn', // sheet threshold
  sheetConfig: { useActiveSpreadsheet: true, sheetName: 'App Logs' },
});

logger.info('Polling for status'); // console only — below sheetLevel
logger.warn('Retrying after failure'); // console + sheet
```

`sheetLevel` defaults to `level` when omitted, so existing configs are unaffected. Useful for high-frequency routes (health checks, status polling) that are worth keeping in the execution log but would otherwise flood the sheet.

### Buffer Writes

```js
const logger = new GasLogger({
  sheetConfig: { useActiveSpreadsheet: true },
  flushThreshold: 25,
  bypassBufferLevels: ['error', 'fatal'],
});
```

By default, every log row is appended to the sheet individually. Set `flushThreshold` to buffer rows in memory and write them in a single batch once the buffer reaches that size. Use `bypassBufferLevels` for levels that should always skip the buffer and write through immediately — e.g. so an `error` isn't lost if the script exits before the next flush.

> **Note:**
> Call `logger.flush()` in a `try`/`finally` block to make sure any remaining buffered rows are written before the script ends.

### Structured Meta

```js
logger.info('Order placed', { orderId: 'ORD-123', total: 49.99 });
```

`meta` is merged into the console payload (as a structured `jsonPayload` for Cloud Logging) and, when a sheet is configured, JSON-stringified into the `meta_json` column.

### Child Loggers

```js
const requestLogger = logger.child({ reqId, userEmail });

requestLogger.info('Handling request'); // meta automatically includes reqId + userEmail

// scope a child to its own thresholds without touching the parent
const pollingLogger = logger.child(
  { route: '/status' },
  { sheetLevel: 'warn' },
);
```

`child()` returns a new logger that merges the given `bindings` into the `meta` of every subsequent call, and reuses the parent's already-resolved sheet and buffer. Pass an optional second `overrides` argument (`level`/`sheetLevel`) to scope just that child to different thresholds — e.g. a route polled continuously that should stay quiet on the sheet.

## Project Details

### Log Levels

Six levels, in ascending severity: `trace` < `debug` < `info` < `warn` < `error` < `fatal`. `level` gates console output; `sheetLevel` (defaults to `level`) independently gates the sheet sink. A call below both thresholds is a no-op.

### Console Output

Every log call is emitted to the Apps Script `console` service, which feeds Cloud Logging with a severity and, when `meta` is present, a structured `jsonPayload`. `trace` and `fatal` have no dedicated `console` method, so they're emitted via `console.info`/`console.error` respectively, with the real level kept in the payload.

### Sheet Output

When `sheetConfig` is provided, each log call is also appended as a row (`timestamp`, `level`, `message`, `meta_json`) to the resolved sheet — either buffered (see [Buffer Writes](#buffer-writes)) or written immediately, one `appendRow` per call, if no `flushThreshold` is set.

## License

MIT

See the `LICENSE` file for details.

## Support

Issues and feature requests are welcome via GitHub Issues.

Maintained by [yorsh-co](https://github.com/yorsh-co).
