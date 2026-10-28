type GasLoggerLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

type GasLoggerConsoleMethod = 'info' | 'warn' | 'error';

/**
 * Lock service the logger takes the script lock through. Anything exposing
 * `withLock` fits, e.g. `GasLock`. `withLock` runs `callback` while holding
 * the lock and throws if the lock can't be acquired within `timeoutMs`.
 */
interface GasLoggerLockService {
  withLock<T>(
    scope: 'script',
    callback: () => T,
    options?: { timeoutMs?: number },
  ): T;
}

/**
 * Sheet state shared by reference between a logger and its children, so
 * the sheet is resolved once and the buffer is common to all of them.
 */
interface GasLoggerSink {
  config: GasLoggerSheetConfig;
  /** `undefined` until resolved; `null` if resolution failed. */
  sheet: GoogleAppsScript.Spreadsheet.Sheet | null | undefined;
  buffer: Array<[string, string, string, string]>;
  flushThreshold: number | null;
  bypassBufferLevels: Set<GasLoggerLevel>;
  lockService: GasLoggerLockService;
}

type GasLoggerMeta = Record<string, unknown>;

interface GasLoggerSheetConfig {
  spreadsheet?: GoogleAppsScript.Spreadsheet.Spreadsheet;
  spreadsheetUrl?: string;
  spreadsheetId?: string;
  /** Default when no spreadsheet configuration is provided */
  useActiveSpreadsheet?: boolean;
  /** Name of the target sheet */
  sheetName?: string;
}

interface GasLoggerOptions {
  /** Minimum level to emit to the console/execution log. @default 'info' */
  level?: GasLoggerLevel;
  /** Minimum level to write to the sheet. @default the `level` value */
  sheetLevel?: GasLoggerLevel;
  sheetConfig?: GasLoggerSheetConfig;
  /** Fields merged into the meta of every log call made by this logger (and its children). */
  bindings?: GasLoggerMeta;
  /** Rows to accumulate before auto-flushing to the sheet. If omitted, rows are appended individually (no buffering). */
  flushThreshold?: number;
  /** Levels that skip the buffer and are appended to the sheet immediately. */
  bypassBufferLevels?: GasLoggerLevel[];
  /**
   * Service the script lock is taken through, for sheet creation and
   * buffered flushes. Pass `GasLock` when the caller holds the script lock
   * itself, so logging inside that section doesn't end it early. Defaults to
   * the `GasLock` global when loaded, else Apps Script's `LockService`.
   */
  lockService?: GasLoggerLockService;
}

/** Per-child threshold overrides accepted by `GasLogger.child()`. */
interface GasLoggerChildOverrides {
  level?: GasLoggerLevel;
  sheetLevel?: GasLoggerLevel;
}
