declare const GAS_LOGGER_COLUMN_KEYS: readonly [
  'timestamp',
  'level',
  'message',
  'meta_json',
];
declare const GAS_LOGGER_KEYS_ROW = 1;
declare const GAS_LOGGER_LEVELS: Record<GasLoggerLevel, number>;
/** Maps each level to the console method that carries the closest severity. */
declare const GAS_LOGGER_CONSOLE_METHOD: Record<
  GasLoggerLevel,
  GasLoggerConsoleMethod
>;
