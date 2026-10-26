declare const GAS_LOGGER_COLUMN_KEYS: readonly [
  'timestamp',
  'level',
  'message',
  'meta_json',
];
declare const GAS_LOGGER_KEYS_ROW = 1;
declare const GAS_LOGGER_DEFAULT_SHEET_NAME = 'gas-log';
declare const GAS_LOGGER_LOCK_TIMEOUT_MS = 10000;
declare const GAS_LOGGER_MAX_CELL_LENGTH = 50000;
declare const GAS_LOGGER_TRUNCATION_MARKER = '\u2026[truncated]';
declare const GAS_LOGGER_LEVELS: Record<GasLoggerLevel, number>;
/** Maps each level to the console method that carries the closest severity. */
declare const GAS_LOGGER_CONSOLE_METHOD: Record<
  GasLoggerLevel,
  GasLoggerConsoleMethod
>;
