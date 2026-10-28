/**
 * Custom logger for Apps Script.
 */
class GasLogger {
  private _level: GasLoggerLevel;
  private _sheetLevel: GasLoggerLevel;
  private _bindings: GasLoggerMeta;
  private _sink: GasLoggerSink | null;

  /**
   * Validates the sheet configuration. No Apps Script service is called
   * here: the sheet is resolved lazily on the first write.
   * Throws if the sheet configuration is invalid.
   */
  constructor(options: GasLoggerOptions = {}) {
    this._level = options.level || 'info';
    this._sheetLevel = options.sheetLevel || this._level;
    this._bindings = options.bindings || {};

    const lockService = this._resolveLockService(options.lockService);

    if (options.sheetConfig) {
      this._validateSheetConfig(options.sheetConfig);
      this._sink = {
        config: options.sheetConfig,
        sheet: undefined,
        buffer: [],
        flushThreshold: options.flushThreshold || null,
        bypassBufferLevels: new Set(options.bypassBufferLevels || []),
        lockService,
      };
    } else {
      this._sink = null;
    }
  }

  /**
   * Validates a lockService, falling back to the library default when
   * omitted. Throws if it doesn't expose `withLock`.
   */
  private _resolveLockService(
    lockService?: GasLoggerLockService,
  ): GasLoggerLockService {
    if (lockService === undefined) return _GAS_LOGGER_DEFAULT_LOCK_SERVICE;

    if (!lockService || typeof lockService.withLock !== 'function') {
      throw new Error(
        '[GasLogger] Invalid "lockService": expected an object exposing withLock(scope, callback, options?), e.g. GasLock. Passing the LockService global from Apps Script rather than GasLock (or a withLock wrapper) is the usual cause.',
      );
    }

    return lockService;
  }

  // =========================
  // SHEET RESOLUTION
  // =========================

  /**
   * Validates the spreadsheet source options of a sheet config.
   * Throws if more than one source is passed, or if
   * `useActiveSpreadsheet` is false and no other source is passed.
   */
  private _validateSheetConfig(config: GasLoggerSheetConfig): void {
    const { spreadsheet, spreadsheetUrl, spreadsheetId, useActiveSpreadsheet } =
      config;

    const sources: Record<string, boolean> = {
      spreadsheet: !!spreadsheet,
      spreadsheetUrl: !!spreadsheetUrl,
      spreadsheetId: !!spreadsheetId,
      useActiveSpreadsheet: !!useActiveSpreadsheet,
    };

    const selected = Object.keys(sources).filter((k) => sources[k]);

    if (selected.length > 1) {
      throw new Error(
        `[GasLogger] Received more than one spreadsheet source option: ${selected.join(', ')}. Pass exactly one of "spreadsheet", "spreadsheetUrl", "spreadsheetId" or "useActiveSpreadsheet".`,
      );
    }

    if (useActiveSpreadsheet === false && selected.length === 0) {
      throw new Error(
        '[GasLogger] "useActiveSpreadsheet" is false, so a spreadsheet source is required. Pass "spreadsheet", "spreadsheetUrl" or "spreadsheetId".',
      );
    }
  }

  /**
   * Returns the shared log sheet, resolving it on first use. If resolution
   * fails, the error is reported once to the console and sheet logging is
   * disabled for the rest of the execution. Returns null when there is no
   * sheet sink or it is disabled.
   */
  private _getSheet(): GoogleAppsScript.Spreadsheet.Sheet | null {
    const sink = this._sink;
    if (!sink) return null;

    if (sink.sheet === undefined) {
      try {
        sink.sheet = this._resolveSheet(sink);
      } catch (error) {
        console.error(
          '[GasLogger] Could not resolve the log sheet; sheet logging is disabled for this execution.',
          error,
        );
        sink.sheet = null;
      }
    }

    return sink.sheet;
  }

  /**
   * Resolve the log sheet in the configured spreadsheet, using the default
   * sheet name when none is configured. A missing sheet is created inside
   * the script lock, so concurrent executions don't race to create it.
   */
  private _resolveSheet(
    sink: GasLoggerSink,
  ): GoogleAppsScript.Spreadsheet.Sheet {
    const { config } = sink;
    const spreadsheet = this._resolveSpreadsheet(config);
    const sheetName = config.sheetName || GAS_LOGGER_DEFAULT_SHEET_NAME;

    return (
      spreadsheet.getSheetByName(sheetName) ||
      this._withLock(
        sink,
        () =>
          spreadsheet.getSheetByName(sheetName) ||
          this._insertSheet(spreadsheet, sheetName),
      )
    );
  }

  /**
   * Resolve the spreadsheet from the provided source option, defaulting
   * to the active spreadsheet.
   */
  private _resolveSpreadsheet(
    config: GasLoggerSheetConfig,
  ): GoogleAppsScript.Spreadsheet.Spreadsheet {
    const { spreadsheet, spreadsheetUrl, spreadsheetId } = config;

    if (spreadsheet) return spreadsheet;
    if (spreadsheetUrl) return SpreadsheetApp.openByUrl(spreadsheetUrl);
    if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

    const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();

    if (!activeSpreadsheet) {
      throw new Error(
        '[GasLogger] No active spreadsheet is accessible by this script. Pass "spreadsheet", "spreadsheetUrl" or "spreadsheetId" instead.',
      );
    }

    return activeSpreadsheet;
  }

  /**
   * Runs `fn` while holding the script lock through the sink's lock service,
   * which releases it afterwards even if `fn` throws. Throws if the lock
   * can't be acquired in time.
   */
  private _withLock<T>(sink: GasLoggerSink, fn: () => T): T {
    return sink.lockService.withLock('script', fn, {
      timeoutMs: GAS_LOGGER_LOCK_TIMEOUT_MS,
    });
  }

  /**
   * Insert a new sheet to the spreadsheet, using the provided
   * name. Applies basic formatting including alternating
   * row colors and a frozen header row.
   */
  private _insertSheet(
    spreadsheet: GoogleAppsScript.Spreadsheet.Spreadsheet,
    sheetName: string,
  ): GoogleAppsScript.Spreadsheet.Sheet {
    const newSheet = spreadsheet.insertSheet(sheetName);

    newSheet
      .getRange(GAS_LOGGER_KEYS_ROW, 1, 1, GAS_LOGGER_COLUMN_KEYS.length)
      .setValues([GAS_LOGGER_COLUMN_KEYS as unknown as string[]]);

    const columnCount = GAS_LOGGER_COLUMN_KEYS.length;

    newSheet
      .getRange(GAS_LOGGER_KEYS_ROW, 1, newSheet.getMaxRows(), columnCount)
      .applyRowBanding();

    newSheet
      .getRange(GAS_LOGGER_KEYS_ROW, 1, 1, columnCount)
      .setFontWeight('bold');

    newSheet.setFrozenRows(GAS_LOGGER_KEYS_ROW);

    Logger.log('[GasLogger] Inserted new log sheet "%s"', sheetName);

    return newSheet;
  }

  // =========================
  // HELPERS
  // =========================

  /**
   * Builds a flat row for the sheet schema. The message and meta cells are
   * made safe for the sheet by `_toCell`.
   */
  private _toRow(
    level: GasLoggerLevel,
    msg: string,
    meta?: GasLoggerMeta,
  ): [string, string, string, string] {
    return [
      new Date().toISOString(),
      level,
      this._toCell(msg),
      meta ? this._toCell(JSON.stringify(meta)) : '',
    ];
  }

  /**
   * Makes free text safe to store in a sheet cell. A leading `=`, `+`, `-`
   * or `@` is prefixed with `'` so Sheets stores the value as text instead
   * of evaluating it as a formula, and the result is cut, ending with a
   * truncation marker, to fit the cell character limit.
   */
  private _toCell(text: string): string {
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;

    if (safe.length <= GAS_LOGGER_MAX_CELL_LENGTH) return safe;

    return (
      safe.slice(
        0,
        GAS_LOGGER_MAX_CELL_LENGTH - GAS_LOGGER_TRUNCATION_MARKER.length,
      ) + GAS_LOGGER_TRUNCATION_MARKER
    );
  }

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
  private _normalizeValue(value: unknown, ancestors: unknown[] = []): unknown {
    if (typeof value === 'bigint') return value.toString();

    if (typeof value !== 'object' || value === null) return value;

    const tag = Object.prototype.toString.call(value);

    if (tag === '[object Date]') return value;

    if (ancestors.includes(value)) return '[Circular]';

    const path = [...ancestors, value];

    if (Array.isArray(value)) {
      return value.map((item) => this._normalizeValue(item, path));
    }

    const source =
      tag === '[object Error]'
        ? {
            name: (value as Error).name,
            message: (value as Error).message,
            stack: (value as Error).stack,
            ...value,
          }
        : (value as Record<string, unknown>);

    return Object.fromEntries(
      Object.entries(source).map(([key, entry]) => [
        key,
        this._normalizeValue(entry, path),
      ]),
    );
  }

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
  private _emit(
    level: GasLoggerLevel,
    msg: string,
    meta?: GasLoggerMeta,
  ): void {
    const fn = GAS_LOGGER_CONSOLE_METHOD[level];
    if (meta || fn !== level) {
      console[fn]({ ...meta, message: msg, level });
    } else {
      console[fn](msg);
    }
  }

  /**
   * Checks whether `level` meets the given threshold.
   */
  private _meetsLevel(
    level: GasLoggerLevel,
    threshold: GasLoggerLevel,
  ): boolean {
    return GAS_LOGGER_LEVELS[level] >= GAS_LOGGER_LEVELS[threshold];
  }

  /**
   * Merges this logger's bound fields into a call's meta. Returns meta
   * unchanged when there are no bindings, so plain-message calls on the
   * root logger are unaffected.
   */
  private _mergeMeta(meta?: GasLoggerMeta): GasLoggerMeta | undefined {
    const hasBindings = Object.keys(this._bindings).length > 0;

    if (!hasBindings) return meta;

    return { ...this._bindings, ...meta };
  }

  /**
   * Reports rows that could not be written to the sheet. Logging never
   * throws because of a sheet write, so the failure is surfaced to the
   * console instead.
   */
  private _reportWriteFailure(rowCount: number, error: unknown): void {
    console.error(
      `[GasLogger] Failed to write ${rowCount} row(s) to the log sheet.`,
      error,
    );
  }

  /**
   * Writes buffered rows to the sheet in one batch. No-op if buffer is empty,
   * no sheet is configured or the sheet could not be resolved. The batch is
   * written under the script lock, so concurrent executions don't overwrite
   * each other, and the sheet grows when it has fewer free rows than the
   * batch needs. The buffer is cleared afterwards even if the write fails;
   * the dropped rows are reported to the console.
   */
  private _flushBuffer(): void {
    const sink = this._sink;

    if (!sink || sink.flushThreshold === null || sink.buffer.length === 0)
      return;

    const sheet = this._getSheet();
    if (!sheet) return;

    const rowCount = sink.buffer.length;

    try {
      this._withLock(sink, () => {
        const startRow = sheet.getLastRow() + 1;
        const overflow = startRow + rowCount - 1 - sheet.getMaxRows();

        if (overflow > 0) sheet.insertRowsAfter(sheet.getMaxRows(), overflow);

        sheet
          .getRange(startRow, 1, rowCount, GAS_LOGGER_COLUMN_KEYS.length)
          .setValues(sink.buffer);
      });
    } catch (error) {
      this._reportWriteFailure(rowCount, error);
    } finally {
      // Truncate in place: child loggers share this array by reference, so
      // rebinding would leave them holding the already-written rows.
      sink.buffer.length = 0;
    }
  }

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
  private _log(level: GasLoggerLevel, msg: string, meta?: GasLoggerMeta): void {
    const logToConsole = this._meetsLevel(level, this._level);
    const sink = this._sink;
    const logToSheet = !!sink && this._meetsLevel(level, this._sheetLevel);

    if (!logToConsole && !logToSheet) return;

    const merged = this._mergeMeta(meta);
    const mergedMeta =
      merged && (this._normalizeValue(merged) as GasLoggerMeta);

    if (logToConsole) this._emit(level, msg, mergedMeta);

    if (!sink || !logToSheet) return;

    const sheet = this._getSheet();
    if (!sheet) return;

    const row = this._toRow(level, msg, mergedMeta);

    const flushThreshold = sink.flushThreshold;

    if (flushThreshold !== null) {
      sink.buffer.push(row);
      if (
        sink.bypassBufferLevels.has(level) ||
        sink.buffer.length >= flushThreshold
      ) {
        this._flushBuffer();
      }
    } else {
      try {
        sheet.appendRow(row);
      } catch (error) {
        this._reportWriteFailure(1, error);
      }
    }
  }

  // =========================
  // CHILD INSTANCE
  // =========================

  /**
   * Creates a child logger that merges the given bindings into the meta
   * of every subsequent log call. Shares the parent's sheet sink, so the
   * sheet is resolved once by whichever logger writes first, and the buffer
   * is common to both. `overrides.level`/`overrides.sheetLevel` scope the
   * child to its own thresholds without affecting the parent.
   */
  child(
    bindings?: GasLoggerMeta,
    overrides: GasLoggerChildOverrides = {},
  ): GasLogger {
    const child = new GasLogger({
      level: overrides.level || this._level,
      sheetLevel: overrides.sheetLevel || this._sheetLevel,
      bindings: { ...this._bindings, ...bindings },
    });

    child._sink = this._sink;

    return child;
  }

  // =========================
  // PUBLIC LOGGER METHODS
  // =========================

  trace(msg: string, meta?: GasLoggerMeta): void {
    this._log('trace', msg, meta);
  }

  debug(msg: string, meta?: GasLoggerMeta): void {
    this._log('debug', msg, meta);
  }

  info(msg: string, meta?: GasLoggerMeta): void {
    this._log('info', msg, meta);
  }

  warn(msg: string, meta?: GasLoggerMeta): void {
    this._log('warn', msg, meta);
  }

  error(msg: string, meta?: GasLoggerMeta): void {
    this._log('error', msg, meta);
  }

  fatal(msg: string, meta?: GasLoggerMeta): void {
    this._log('fatal', msg, meta);
  }

  /**
   * Flushes all buffered rows to the sheet and clears the buffer.
   * No-op if no sheet is configured, the sheet could not be resolved, or
   * the buffer is empty.
   * Call this in a try/finally block to ensure buffered rows are written
   * before the script ends.
   */
  flush(): void {
    this._flushBuffer();
  }
}
