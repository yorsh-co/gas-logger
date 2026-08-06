/**
 * Custom logger for Apps Script.
 */
declare class GasLogger {
  private _level;
  private _sheetConfig;
  private _sheetLevel;
  private _sheet;
  private _bindings;
  private _buffer;
  private _flushThreshold;
  private _bypassBufferLevels;
  constructor(options?: GasLoggerOptions);
  /**
   * Resolve the spreadsheet from the provided source option.
   * Throws if more than on source is passed in options.
   */
  private _resolveSheet;
  /**
   * Resolve the spreadsheet from the provided source option.
   * Throws if more than on source is passed in options.
   */
  private _resolveSpreadsheet;
  /**
   * Insert a new sheet to the spreadsheet, using the provided
   * name. Applies basic formatting including alternating
   * row colors and a frozen header row.
   */
  private _insertSheet;
  /**
   * Builds a flat row for the sheet schema.
   */
  private _toRow;
  /**
   * Emits to the console service so entries feed Cloud Logging with a
   * severity and, when meta is present, a structured jsonPayload.
   * `trace`/`fatal` have no dedicated console method, so they're emitted
   * via `info`/`error`, with the real level kept in the payload.
   * @param {GasLoggerLevel} level
   * @param {string} msg
   * @param {Object} [meta]
   */
  private _emit;
  /**
   * Checks whether `level` meets the given threshold.
   */
  private _meetsLevel;
  /**
   * Merges this logger's bound fields into a call's meta. Returns meta
   * unchanged when there are no bindings, so plain-message calls on the
   * root logger are unaffected.
   */
  private _mergeMeta;
  /**
   * Writes buffered rows to the sheet in one batch. No-op if buffer is empty
   * or no sheet is configured. Clears the buffer after writing.
   */
  private _flushBuffer;
  /**
   * Core log dispatch. Console emission and the sheet are gated by their own
   * independent thresholds (`_level`, `_sheetLevel`), so a route can stay
   * verbose in Cloud Logging while only surfacing warnings and up on the
   * sheet. Routes to buffer or directly to sheet based on whether buffering
   * is enabled and if the level should bypass the buffer.
   */
  private _log;
  /**
   * Creates a child logger that merges the given bindings into the meta
   * of every subsequent log call. Reuses the parent's already-resolved
   * sheet and buffer. `overrides.level`/`overrides.sheetLevel` scope the
   * child to its own thresholds without affecting the parent.
   */
  child(
    bindings?: GasLoggerMeta,
    overrides?: GasLoggerChildOverrides,
  ): GasLogger;
  trace(msg: string, meta?: GasLoggerMeta): void;
  debug(msg: string, meta?: GasLoggerMeta): void;
  info(msg: string, meta?: GasLoggerMeta): void;
  warn(msg: string, meta?: GasLoggerMeta): void;
  error(msg: string, meta?: GasLoggerMeta): void;
  fatal(msg: string, meta?: GasLoggerMeta): void;
  /**
   * Flushes all buffered rows to the sheet and clears the buffer.
   * No-op if no sheet is configured or buffer is empty.
   * Call this in a try/finally block to ensure buffered rows are written
   * before the script ends.
   */
  flush(): void;
}
