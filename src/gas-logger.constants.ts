/* Column keys to be used in the log sheet */
const GAS_LOGGER_COLUMN_KEYS = [
  'timestamp',
  'level',
  'message',
  'meta_json',
] as const;

/* The index base-1 row number where the columns keys will be inserted */
const GAS_LOGGER_KEYS_ROW = 1;

/* Name of the log sheet when `sheetConfig.sheetName` is not provided */
const GAS_LOGGER_DEFAULT_SHEET_NAME = 'gas-log';

/* Milliseconds to wait for the script lock before giving up */
const GAS_LOGGER_LOCK_TIMEOUT_MS = 10000;

/* Maximum characters a sheet cell accepts; longer text is cut to fit */
const GAS_LOGGER_MAX_CELL_LENGTH = 50000;

/* Appended to a cell cut to GAS_LOGGER_MAX_CELL_LENGTH */
const GAS_LOGGER_TRUNCATION_MARKER = '…[truncated]';

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
