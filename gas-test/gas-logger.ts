type TestSpreadsheet = GoogleAppsScript.Spreadsheet.Spreadsheet;
type TestSheet = GoogleAppsScript.Spreadsheet.Sheet;

const MESSAGE_COLUMN = 3;
const META_COLUMN = 4;
const TRUNCATION_SUFFIX = '…[truncated]';

/** Returns the named sheet, or null when it does not exist. */
const logSheet = (
  spreadsheet: TestSpreadsheet,
  name: string,
): TestSheet | null => spreadsheet.getSheetByName(name);

/** Returns the named sheet, failing the test when it does not exist. */
const requireSheet = (
  spreadsheet: TestSpreadsheet,
  name: string,
): TestSheet => {
  const sheet = logSheet(spreadsheet, name);
  assert(sheet !== null, `sheet "${name}" should exist`);
  return sheet;
};

/** Creates a logger writing to `sheetName` in the test spreadsheet. */
const newLogger = (
  spreadsheet: TestSpreadsheet,
  sheetName: string,
  options: GasLoggerOptions = {},
): GasLogger =>
  new GasLogger({ ...options, sheetConfig: { spreadsheet, sheetName } });

/** Stored values of one column below the header, in row order. */
const columnValues = (sheet: TestSheet, column: number): unknown[] => {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet
    .getRange(2, column, last - 1, 1)
    .getValues()
    .map((row) => row[0] as unknown);
};

/** Stored messages below the header, in row order. */
const messages = (sheet: TestSheet): unknown[] =>
  columnValues(sheet, MESSAGE_COLUMN);

/** Asserts the stored messages equal `expected`, in order. */
const assertMessages = (sheet: TestSheet, expected: string[]): void => {
  const actual = messages(sheet);
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected messages ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
};

/** Lock service that records scopes and what GasLock reports inside. */
const recordingLockService = () => {
  const calls: string[] = [];
  const heldInside: boolean[] = [];
  const lockService: GasLoggerLockService = {
    withLock<T>(
      scope: 'script',
      callback: () => T,
      options?: { timeoutMs?: number },
    ): T {
      calls.push(scope);
      return GasLock.withLock(
        scope,
        () => {
          heldInside.push(GasLock.isHeld('script'));
          return callback();
        },
        options,
      );
    },
  };
  return { calls, heldInside, lockService };
};

test('sheet creation', ({ prefix, spreadsheet }) => {
  const name = `${prefix}create`;
  assert(logSheet(spreadsheet, name) === null, 'sheet should not exist yet');

  newLogger(spreadsheet, name).info('first');

  const sheet = requireSheet(spreadsheet, name);
  const header = sheet.getRange(1, 1, 1, 4).getValues()[0];
  assert(
    JSON.stringify(header) ===
      JSON.stringify(['timestamp', 'level', 'message', 'meta_json']),
    `unexpected header ${JSON.stringify(header)}`,
  );
  assert(sheet.getFrozenRows() === 1, 'row 1 should be frozen');
  assert(
    sheet.getRange(1, 1).getFontWeight() === 'bold',
    'header should be bold',
  );
  assert(sheet.getBandings().length > 0, 'sheet should have banding');
  assert(sheet.getLastRow() === 2, 'expected the header and one data row');

  newLogger(spreadsheet, name).info('second');

  const copies = spreadsheet
    .getSheets()
    .filter((candidate) => candidate.getName() === name);
  assert(copies.length === 1, 'a second logger should reuse the sheet');
  assertMessages(sheet, ['first', 'second']);
});

test('creation takes the lock', ({ prefix, spreadsheet }) => {
  const { calls, heldInside, lockService } = recordingLockService();
  const logger = newLogger(spreadsheet, `${prefix}lock-create`, {
    lockService,
  });

  logger.info('created');
  logger.info('reused');

  assert(
    JSON.stringify(calls) === '["script"]',
    `expected one script lock for creation, got ${JSON.stringify(calls)}`,
  );
  assert(heldInside[0] === true, 'GasLock should report the lock held inside');
  assert(!GasLock.isHeld('script'), 'lock should be released afterwards');
});

test('default lock service', ({ prefix, spreadsheet }) => {
  const original = GasLock.withLock;
  const calls: string[] = [];
  GasLock.withLock = function <T>(
    scope: GasLockScope,
    callback: () => T,
    options?: GasLockOptions,
  ): T {
    calls.push(scope);
    return original.call(GasLock, scope, callback, options) as T;
  };

  try {
    const logger = newLogger(spreadsheet, `${prefix}lock-default`, {
      flushThreshold: 2,
    });
    logger.info('a');
    logger.info('b');

    assert(
      JSON.stringify(calls) === '["script","script"]',
      `expected creation and flush through GasLock, got ${JSON.stringify(calls)}`,
    );
  } finally {
    GasLock.withLock = original;
  }
});

test('formula escaping', ({ prefix, spreadsheet }) => {
  const inputs = ['=1+1', '+1', '-5', '@x'];
  const variants: Array<[string, GasLoggerOptions]> = [
    ['unbuffered', {}],
    ['buffered', { flushThreshold: inputs.length }],
  ];

  variants.forEach(([variant, options]) => {
    const name = `${prefix}escape-${variant}`;
    const logger = newLogger(spreadsheet, name, options);
    inputs.forEach((input) => logger.info(input));
    logger.flush();

    const sheet = requireSheet(spreadsheet, name);
    inputs.forEach((input, index) => {
      const cell = sheet.getRange(index + 2, MESSAGE_COLUMN);
      const value: unknown = cell.getValue();
      assert(
        value === input,
        `${variant}: ${JSON.stringify(input)} stored as ${JSON.stringify(value)} (${typeof value})`,
      );
      assert(
        cell.getFormula() === '',
        `${variant}: ${JSON.stringify(input)} was stored as a formula`,
      );
    });
  });
});

test('truncation', ({ prefix, spreadsheet }) => {
  const name = `${prefix}truncate`;
  const logger = newLogger(spreadsheet, name);

  logger.info('x'.repeat(60000), { blob: 'y'.repeat(60000) });

  const sheet = requireSheet(spreadsheet, name);
  [MESSAGE_COLUMN, META_COLUMN].forEach((column) => {
    const value = String(sheet.getRange(2, column).getValue());
    assert(value.length === 50000, `column ${column}: length ${value.length}`);
    assert(
      value.endsWith(TRUNCATION_SUFFIX),
      `column ${column} should end with the truncation marker`,
    );
  });
});

info('cell limit', ({ prefix, spreadsheet }) => {
  const sheet = spreadsheet.insertSheet(`${prefix}cell-limit`);
  try {
    sheet.getRange(1, 1).setValue('z'.repeat(GAS_LOGGER_MAX_CELL_LENGTH + 1));
    SpreadsheetApp.flush();
    const stored = String(sheet.getRange(1, 1).getValue()).length;
    return `accepted ${GAS_LOGGER_MAX_CELL_LENGTH + 1} characters, stored length ${stored}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
});

test('buffered flush', ({ prefix, spreadsheet }) => {
  const name = `${prefix}buffer`;
  const logger = newLogger(spreadsheet, name, { flushThreshold: 3 });

  logger.info('m1');
  logger.info('m2');
  const sheet = requireSheet(spreadsheet, name);
  assert(sheet.getLastRow() === 1, 'two entries should stay buffered');

  logger.info('m3');
  assertMessages(sheet, ['m1', 'm2', 'm3']);

  logger.info('m4');
  assertMessages(sheet, ['m1', 'm2', 'm3']);
  logger.flush();
  assertMessages(sheet, ['m1', 'm2', 'm3', 'm4']);
});

test('bypass flush', ({ prefix, spreadsheet }) => {
  const name = `${prefix}bypass`;
  const logger = newLogger(spreadsheet, name, {
    flushThreshold: 10,
    bypassBufferLevels: ['error'],
  });

  logger.info('pending 1');
  logger.warn('pending 2');
  const sheet = requireSheet(spreadsheet, name);
  assert(sheet.getLastRow() === 1, 'entries should stay buffered');

  logger.error('bypass');
  assertMessages(sheet, ['pending 1', 'pending 2', 'bypass']);
});

test('flush grows the sheet', ({ prefix, spreadsheet }) => {
  const name = `${prefix}grow`;
  newLogger(spreadsheet, name).info('seed');
  const sheet = requireSheet(spreadsheet, name);

  const surplus = sheet.getMaxRows() - sheet.getLastRow() - 1;
  assert(surplus > 0, 'sheet should have rows to delete');
  sheet.deleteRows(sheet.getLastRow() + 1, surplus);
  assert(
    sheet.getMaxRows() - sheet.getLastRow() === 1,
    'sheet should have one free row',
  );

  const batch = ['g1', 'g2', 'g3', 'g4', 'g5'];
  const logger = newLogger(spreadsheet, name, { flushThreshold: batch.length });
  batch.forEach((message) => logger.info(message));

  assertMessages(sheet, ['seed', ...batch]);
});

test('inside a caller GasLock', ({ prefix, spreadsheet }) => {
  const name = `${prefix}caller-gaslock`;

  GasLock.withLock('script', () => {
    const logger = newLogger(spreadsheet, name, { flushThreshold: 2 });
    logger.info('a');
    logger.info('b');

    assert(GasLock.isHeld('script'), 'GasLock should still hold the scope');
    assert(
      LockService.getScriptLock().hasLock(),
      'the execution should still hold the script lock',
    );
  });

  assertMessages(requireSheet(spreadsheet, name), ['a', 'b']);
});

// Documented hazard: raw LockService locks are owned per execution, so the
// fallback's release ends the caller's section.
test('inside a caller raw lock ends it', ({ prefix, spreadsheet }) => {
  const name = `${prefix}caller-raw`;
  newLogger(spreadsheet, name).info('seed');

  const raw = LockService.getScriptLock();
  raw.waitLock(10000);
  try {
    const logger = newLogger(spreadsheet, name, {
      flushThreshold: 2,
      lockService: _GAS_LOGGER_FALLBACK_LOCK_SERVICE,
    });
    logger.info('a');
    logger.info('b');

    assert(
      !raw.hasLock(),
      "the flush should have ended the caller's raw lock section",
    );
  } finally {
    if (raw.hasLock()) raw.releaseLock();
  }
});

test('write failure does not throw', ({ prefix, spreadsheet }) => {
  if (spreadsheet.getSheets().length < 2) {
    spreadsheet.insertSheet(`${prefix}keep`);
  }

  const unbufferedName = `${prefix}fail-unbuffered`;
  const unbuffered = newLogger(spreadsheet, unbufferedName);
  unbuffered.info('resolve');
  spreadsheet.deleteSheet(requireSheet(spreadsheet, unbufferedName));

  const bufferedName = `${prefix}fail-buffered`;
  const buffered = newLogger(spreadsheet, bufferedName, { flushThreshold: 2 });
  buffered.info('resolve');
  spreadsheet.deleteSheet(requireSheet(spreadsheet, bufferedName));

  try {
    unbuffered.info('after delete');
    buffered.info('after delete');
    buffered.flush();
  } catch (error) {
    assert(false, `logging threw: ${String(error)}`);
  }
});

info('timestamp cell', ({ prefix, spreadsheet }) => {
  const tag = (name: string, options: GasLoggerOptions): string => {
    const sheetName = `${prefix}timestamp-${name}`;
    const logger = newLogger(spreadsheet, sheetName, options);
    logger.info('t');
    logger.flush();
    const value: unknown = requireSheet(spreadsheet, sheetName)
      .getRange(2, 1)
      .getValue();
    return `${name}: ${Object.prototype.toString.call(value)}`;
  };

  return [tag('appendRow', {}), tag('setValues', { flushThreshold: 5 })].join(
    '; ',
  );
});
