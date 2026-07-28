type GasLoggerLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type GasLoggerConsoleMethod = 'info' | 'warn' | 'error';
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
}
/** Per-child threshold overrides accepted by `GasLogger.child()`. */
interface GasLoggerChildOverrides {
  level?: GasLoggerLevel;
  sheetLevel?: GasLoggerLevel;
}
