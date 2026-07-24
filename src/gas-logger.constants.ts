/* Column keys to be used in the log sheet */
const GAS_LOGGER_COLUMN_KEYS = [
  'timestamp',
  'level',
  'message',
  'meta_json',
] as const;

/* The index base-1 row number where the columns keys will be inserted */
const GAS_LOGGER_KEYS_ROW = 1;

const GAS_LOGGER_LEVELS: Record<GasLoggerLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Maps each level to the console method that carries the closest severity. */
const GAS_LOGGER_CONSOLE_METHOD: Record<
  GasLoggerLevel,
  GasLoggerConsoleMethod
> = {
  trace: 'info',
  debug: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};
