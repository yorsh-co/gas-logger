'use strict';
/* Column keys to be used in the log sheet */
const GAS_LOGGER_COLUMN_KEYS = ['timestamp', 'level', 'message', 'meta_json'];
/* The index base-1 row number where the columns keys will be inserted */
const GAS_LOGGER_KEYS_ROW = 1;
/* Name of the log sheet when `sheetConfig.sheetName` is not provided */
const GAS_LOGGER_DEFAULT_SHEET_NAME = 'gas-log';
/* Milliseconds to wait for the script lock before giving up */
const GAS_LOGGER_LOCK_TIMEOUT_MS = 10000;
/**
 * Lock service backed by Apps Script's `LockService`. Locks are owned per
 * execution, so taking and releasing the script lock here while the caller
 * already holds it ends the caller's critical section early. Load GasLock to
 * get a reentrant lock instead.
 */
const _GAS_LOGGER_FALLBACK_LOCK_SERVICE = Object.freeze({
  withLock(scope, callback, options = {}) {
    void scope;
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(options.timeoutMs ?? GAS_LOGGER_LOCK_TIMEOUT_MS)) {
      throw new Error('[GasLogger] Timed out waiting for the script lock.');
    }
    try {
      return callback();
    } finally {
      lock.releaseLock();
    }
  },
});
/**
 * Default lock service: the `GasLock` global when it is loaded, else the
 * fallback. The global is looked up on every acquisition rather than at
 * construction, as a GasLogger is often constructed at top level, before
 * gas-lock's file has been evaluated.
 */
const _GAS_LOGGER_DEFAULT_LOCK_SERVICE = Object.freeze({
  withLock(scope, callback, options) {
    let service = _GAS_LOGGER_FALLBACK_LOCK_SERVICE;
    try {
      if (
        typeof GasLock !== 'undefined' &&
        typeof GasLock.withLock === 'function'
      ) {
        service = GasLock;
      }
    } catch {
      // typeof on a binding not yet initialised throws a ReferenceError
    }
    return service.withLock(scope, callback, options);
  },
});
/* Maximum characters a sheet cell accepts; longer text is cut to fit */
const GAS_LOGGER_MAX_CELL_LENGTH = 50000;
/* Appended to a cell cut to GAS_LOGGER_MAX_CELL_LENGTH */
const GAS_LOGGER_TRUNCATION_MARKER = '…[truncated]';
const GAS_LOGGER_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};
/** Maps each level to the console method that carries the closest severity. */
const GAS_LOGGER_CONSOLE_METHOD = {
  trace: 'info',
  debug: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};
