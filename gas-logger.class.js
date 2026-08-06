'use strict';
/**
 * Custom logger for Apps Script.
 */
class GasLogger {
  constructor(options = {}) {
    this._level = options.level || 'info';
    this._sheetLevel = options.sheetLevel || this._level;
    this._sheetConfig = options.sheetConfig || {};
    this._sheet = Object.keys(this._sheetConfig).length
      ? this._resolveSheet()
      : null;
    this._bindings = options.bindings || {};
    this._flushThreshold = options.flushThreshold || null;
    this._buffer = [];
    this._bypassBufferLevels = new Set(options.bypassBufferLevels || []);
  }
  // =========================
  // CONSTRUCTOR HELPERS
  // =========================
  /**
   * Resolve the spreadsheet from the provided source option.
   * Throws if more than on source is passed in options.
   */
  _resolveSheet() {
    const spreadsheet = this._resolveSpreadsheet();
    const { sheetName } = this._sheetConfig;
    if (sheetName) {
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (sheet) return sheet;
    }
    return this._insertSheet(spreadsheet, sheetName);
  }
  /**
   * Resolve the spreadsheet from the provided source option.
   * Throws if more than on source is passed in options.
   */
  _resolveSpreadsheet() {
    const { spreadsheet, spreadsheetUrl, spreadsheetId, useActiveSpreadsheet } =
      this._sheetConfig;
    // filter arguments
    const sources = {
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
    let sourceSpreadsheet;
    // return spreadsheet by the indicated method
    if (spreadsheet) {
      sourceSpreadsheet = spreadsheet;
    } else if (spreadsheetUrl) {
      sourceSpreadsheet = SpreadsheetApp.openByUrl(spreadsheetUrl);
    } else if (spreadsheetId) {
      sourceSpreadsheet = SpreadsheetApp.openById(spreadsheetId);
    }
    // default: return active spreadsheet
    else {
      const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
      if (!activeSpreadsheet) {
        throw new Error(
          '[GasLogger] No active spreadsheet is accessible by this script. Pass "spreadsheet", "spreadsheetUrl" or "spreadsheetId" instead.',
        );
      }
      sourceSpreadsheet = activeSpreadsheet;
    }
    return sourceSpreadsheet;
  }
  /**
   * Insert a new sheet to the spreadsheet, using the provided
   * name. Applies basic formatting including alternating
   * row colors and a frozen header row.
   */
  _insertSheet(spreadsheet, sheetName = null) {
    let newSheetName = sheetName;
    if (!newSheetName) {
      const allSheetNames = spreadsheet
        .getSheets()
        .map((s) => s.getSheetName());
      const defaultSheetName = 'gas-log-{i}';
      let i = 0;
      do {
        newSheetName = defaultSheetName.replace('{i}', String(i++));
      } while (allSheetNames.includes(newSheetName));
    }
    const newSheet = spreadsheet.insertSheet(newSheetName);
    newSheet
      .getRange(GAS_LOGGER_KEYS_ROW, 1, 1, GAS_LOGGER_COLUMN_KEYS.length)
      .setValues([GAS_LOGGER_COLUMN_KEYS]);
    const maxCols = newSheet.getMaxColumns();
    newSheet
      .getRange(GAS_LOGGER_KEYS_ROW, 1, newSheet.getMaxRows(), maxCols)
      .applyRowBanding();
    newSheet.getRange(GAS_LOGGER_KEYS_ROW, 1, 1, maxCols).setFontWeight('bold');
    newSheet.setFrozenRows(GAS_LOGGER_KEYS_ROW);
    Logger.log('[GasLogger] Inserted new log sheet "%s"', newSheetName);
    return newSheet;
  }
  // =========================
  // HELPERS
  // =========================
  /**
   * Builds a flat row for the sheet schema.
   */
  _toRow(level, msg, meta) {
    return [
      new Date().toISOString(),
      level,
      msg,
      meta ? JSON.stringify(meta) : '',
    ];
  }
  /**
   * Emits to the console service so entries feed Cloud Logging with a
   * severity and, when meta is present, a structured jsonPayload.
   * `trace`/`fatal` have no dedicated console method, so they're emitted
   * via `info`/`error`, with the real level kept in the payload.
   * @param {GasLoggerLevel} level
   * @param {string} msg
   * @param {Object} [meta]
   */
  _emit(level, msg, meta) {
    const fn = GAS_LOGGER_CONSOLE_METHOD[level];
    if (meta) {
      console[fn]({ message: msg, level, ...meta });
    } else {
      console[fn](msg);
    }
  }
  /**
   * Checks whether `level` meets the given threshold.
   */
  _meetsLevel(level, threshold) {
    return GAS_LOGGER_LEVELS[level] >= GAS_LOGGER_LEVELS[threshold];
  }
  /**
   * Merges this logger's bound fields into a call's meta. Returns meta
   * unchanged when there are no bindings, so plain-message calls on the
   * root logger are unaffected.
   */
  _mergeMeta(meta) {
    const hasBindings = Object.keys(this._bindings).length > 0;
    if (!hasBindings) return meta;
    return { ...this._bindings, ...meta };
  }
  /**
   * Writes buffered rows to the sheet in one batch. No-op if buffer is empty
   * or no sheet is configured. Clears the buffer after writing.
   */
  _flushBuffer() {
    if (
      this._flushThreshold === null ||
      !this._sheet ||
      this._buffer.length === 0
    )
      return;
    const startRow = this._sheet.getLastRow() + 1;
    this._sheet
      .getRange(startRow, 1, this._buffer.length, 4)
      .setValues(this._buffer);
    this._buffer = [];
  }
  /**
   * Core log dispatch. Console emission and the sheet are gated by their own
   * independent thresholds (`_level`, `_sheetLevel`), so a route can stay
   * verbose in Cloud Logging while only surfacing warnings and up on the
   * sheet. Routes to buffer or directly to sheet based on whether buffering
   * is enabled and if the level should bypass the buffer.
   */
  _log(level, msg, meta) {
    const logToConsole = this._meetsLevel(level, this._level);
    const logToSheet =
      !!this._sheet && this._meetsLevel(level, this._sheetLevel);
    if (!logToConsole && !logToSheet) return;
    const mergedMeta = this._mergeMeta(meta);
    if (logToConsole) this._emit(level, msg, mergedMeta);
    if (!this._sheet || !logToSheet) return;
    const row = this._toRow(level, msg, mergedMeta);
    const flushThreshold = this._flushThreshold;
    const shouldBuffer =
      flushThreshold !== null && !this._bypassBufferLevels.has(level);
    if (shouldBuffer) {
      this._buffer.push(row);
      if (this._buffer.length >= flushThreshold) {
        this._flushBuffer();
      }
    } else {
      this._sheet.appendRow(row);
    }
  }
  // =========================
  // CHILD INSTANCE
  // =========================
  /**
   * Creates a child logger that merges the given bindings into the meta
   * of every subsequent log call. Reuses the parent's already-resolved
   * sheet and buffer. `overrides.level`/`overrides.sheetLevel` scope the
   * child to its own thresholds without affecting the parent.
   */
  child(bindings, overrides = {}) {
    const child = Object.create(GasLogger.prototype);
    child._level = overrides.level || this._level;
    child._sheetLevel = overrides.sheetLevel || this._sheetLevel;
    child._sheetConfig = this._sheetConfig;
    child._sheet = this._sheet;
    child._bindings = { ...this._bindings, ...bindings };
    child._buffer = this._buffer;
    child._flushThreshold = this._flushThreshold;
    child._bypassBufferLevels = this._bypassBufferLevels;
    return child;
  }
  // =========================
  // PUBLIC LOGGER METHODS
  // =========================
  trace(msg, meta) {
    this._log('trace', msg, meta);
  }
  debug(msg, meta) {
    this._log('debug', msg, meta);
  }
  info(msg, meta) {
    this._log('info', msg, meta);
  }
  warn(msg, meta) {
    this._log('warn', msg, meta);
  }
  error(msg, meta) {
    this._log('error', msg, meta);
  }
  fatal(msg, meta) {
    this._log('fatal', msg, meta);
  }
  /**
   * Flushes all buffered rows to the sheet and clears the buffer.
   * No-op if no sheet is configured or buffer is empty.
   * Call this in a try/finally block to ensure buffered rows are written
   * before the script ends.
   */
  flush() {
    this._flushBuffer();
  }
}
