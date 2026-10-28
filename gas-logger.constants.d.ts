declare const GAS_LOGGER_COLUMN_KEYS: readonly [
  'timestamp',
  'level',
  'message',
  'meta_json',
];
declare const GAS_LOGGER_KEYS_ROW = 1;
declare const GAS_LOGGER_DEFAULT_SHEET_NAME = 'gas-log';
declare const GAS_LOGGER_LOCK_TIMEOUT_MS = 10000;
/**
 * Lock service backed by Apps Script's `LockService`. Locks are owned per
 * execution, so taking and releasing the script lock here while the caller
 * already holds it ends the caller's critical section early. Load GasLock to
 * get a reentrant lock instead.
 */
declare const _GAS_LOGGER_FALLBACK_LOCK_SERVICE: GasLoggerLockService;
/**
 * Default lock service: the `GasLock` global when it is loaded, else the
 * fallback. The global is looked up on every acquisition rather than at
 * construction, as a GasLogger is often constructed at top level, before
 * gas-lock's file has been evaluated.
 */
declare const _GAS_LOGGER_DEFAULT_LOCK_SERVICE: GasLoggerLockService;
declare const GAS_LOGGER_MAX_CELL_LENGTH = 50000;
declare const GAS_LOGGER_TRUNCATION_MARKER = '\u2026[truncated]';
declare const GAS_LOGGER_LEVELS: Record<GasLoggerLevel, number>;
/** Maps each level to the console method that carries the closest severity. */
declare const GAS_LOGGER_CONSOLE_METHOD: Record<
  GasLoggerLevel,
  GasLoggerConsoleMethod
>;
