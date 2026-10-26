/**
 * Custom logger for Apps Script.
 */
declare class GasLogger {
  private _level;
  private _sheetLevel;
  private _bindings;
  private _sink;
  /**
   * Validates the sheet configuration. No Apps Script service is called
   * here: the sheet is resolved lazily on the first write.
   * Throws if the sheet configuration is invalid.
   */
  constructor(options?: GasLoggerOptions);
  /**
   * Validates the spreadsheet source options of a sheet config.
   * Throws if more than one source is passed, or if
   * `useActiveSpreadsheet` is false and no other source is passed.
   */
  private _validateSheetConfig;
  /**
   * Returns the shared log sheet, resolving it on first use. If resolution
   * fails, the error is reported once to the console and sheet logging is
   * disabled for the rest of the execution. Returns null when there is no
   * sheet sink or it is disabled.
   */
  private _getSheet;
  /**
   * Resolve the log sheet in the configured spreadsheet, using the default
   * sheet name when none is configured. A missing sheet is created inside
   * the script lock, so concurrent executions don't race to create it.
   */
  private _resolveSheet;
  /**
   * Resolve the spreadsheet from the provided source option, defaulting
   * to the active spreadsheet.
   */
  private _resolveSpreadsheet;
  /**
   * Runs `fn` while holding the script lock, which is released afterwards
   * even if `fn` throws. Throws if the lock can't be acquired in time.
   */
  private _withLock;
  /**
   * Insert a new sheet to the spreadsheet, using the provided
   * name. Applies basic formatting including alternating
   * row colors and a frozen header row.
   */
  private _insertSheet;
  /**
   * Builds a flat row for the sheet schema. The message and meta cells are
   * made safe for the sheet by `_toCell`.
   */
  private _toRow;
  /**
   * Makes free text safe to store in a sheet cell. A leading `=`, `+`, `-`
   * or `@` is prefixed with `'` so Sheets stores the value as text instead
   * of evaluating it as a formula, and the result is cut, ending with a
   * truncation marker, to fit the cell character limit.
   */
  private _toCell;
  /**
   * Converts a value into a JSON-safe plain copy. Errors become plain
   * objects with their name, message, stack and own enumerable properties,
   * bigints become strings and circular references become `'[Circular]'`.
   * Only the ancestors of the current value are tracked, so an object
   * referenced twice without a cycle is serialized both times. Dates are
   * kept as-is: JSON and the console both render them as ISO strings.
   * @param {unknown} value
   * @param {unknown[]} [ancestors] Objects on the path to `value`.
   */
  private _normalizeValue;
  /**
   * Emits to the console service so entries feed Cloud Logging with a
   * severity and, when meta is present, a structured jsonPayload.
   * `trace`/`debug`/`fatal` have no console method of their own, so they're
   * emitted via `info`/`error` and always use the payload form, which
   * carries the real level. `message` and `level` come last so meta can't
   * override them.
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
   * Reports rows that could not be written to the sheet. Logging never
   * throws because of a sheet write, so the failure is surfaced to the
   * console instead.
   */
  private _reportWriteFailure;
  /**
   * Writes buffered rows to the sheet in one batch. No-op if buffer is empty,
   * no sheet is configured or the sheet could not be resolved. The batch is
   * written under the script lock, so concurrent executions don't overwrite
   * each other, and the sheet grows when it has fewer free rows than the
   * batch needs. The buffer is cleared afterwards even if the write fails;
   * the dropped rows are reported to the console.
   */
  private _flushBuffer;
  /**
   * Core log dispatch. Console emission and the sheet are gated by their own
   * independent thresholds (`_level`, `_sheetLevel`), so a route can stay
   * verbose in Cloud Logging while only surfacing warnings and up on the
   * sheet. Routes to buffer or directly to sheet based on whether buffering
   * is enabled. With buffering, a bypass-level entry joins the buffer and
   * flushes it immediately, so it is written in order with any pending rows
   * in a single locked batch. The sheet is resolved on the first entry that
   * meets `_sheetLevel`.
   */
  private _log;
  /**
   * Creates a child logger that merges the given bindings into the meta
   * of every subsequent log call. Shares the parent's sheet sink, so the
   * sheet is resolved once by whichever logger writes first, and the buffer
   * is common to both. `overrides.level`/`overrides.sheetLevel` scope the
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
   * No-op if no sheet is configured, the sheet could not be resolved, or
   * the buffer is empty.
   * Call this in a try/finally block to ensure buffered rows are written
   * before the script ends.
   */
  flush(): void;
}
