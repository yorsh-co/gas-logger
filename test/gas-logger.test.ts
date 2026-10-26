import { describe, expect, it } from 'vitest';
import { loadGasLogger, type GasLoggerTestOptions } from './harness';
import { FakeSheet, FakeSpreadsheet } from './mocks';

const HEADER = ['timestamp', 'level', 'message', 'meta_json'];

/** Loads a logger writing to the active spreadsheet. */
function setup(options: GasLoggerTestOptions = {}) {
  const { GasLogger, mocks } = loadGasLogger();
  const logger = new GasLogger({
    sheetConfig: { useActiveSpreadsheet: true },
    ...options,
  });
  return { GasLogger, mocks, logger };
}

/** The log sheet of the active spreadsheet. */
function logSheet(spreadsheet: FakeSpreadsheet): FakeSheet {
  const sheet = spreadsheet.getSheets()[0];
  if (!sheet) throw new Error('No log sheet was created');
  return sheet;
}

/** Data rows (header excluded) as `[level, message, meta_json]`. */
function dataRows(sheet: FakeSheet): string[][] {
  return sheet.values.slice(1).map((row) => row.slice(1));
}

describe('level gating', () => {
  it('defaults to info', () => {
    const { mocks, logger } = setup();

    logger.debug('hidden');
    logger.info('shown');

    expect(mocks.console.info).toHaveBeenCalledTimes(1);
    expect(mocks.console.info).toHaveBeenCalledWith('shown');
  });

  it('gates console output by level', () => {
    const { mocks, logger } = setup({ level: 'error' });

    logger.warn('hidden');
    logger.error('shown');

    expect(mocks.console.warn).not.toHaveBeenCalled();
    expect(mocks.console.error).toHaveBeenCalledWith('shown');
  });

  it('gates the sheet by sheetLevel independently of level', () => {
    const { mocks, logger } = setup({ level: 'error', sheetLevel: 'debug' });

    logger.info('sheet only');

    expect(mocks.console.info).not.toHaveBeenCalled();
    expect(dataRows(logSheet(mocks.activeSpreadsheet))).toEqual([
      ['info', 'sheet only', ''],
    ]);
  });

  it('keeps the sheet quiet when only the console threshold is met', () => {
    const { mocks, logger } = setup({ level: 'debug', sheetLevel: 'error' });

    logger.info('console only');

    expect(mocks.console.info).toHaveBeenCalledWith('console only');
    expect(dataRows(logSheet(mocks.activeSpreadsheet))).toEqual([]);
  });
});

describe('console output', () => {
  it.each([
    ['trace', 'info'],
    ['debug', 'info'],
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
    ['fatal', 'error'],
  ] as const)('maps %s to console.%s', (level, method) => {
    const { mocks, logger } = setup({ level: 'trace' });

    logger[level]('msg');

    expect(mocks.console[method]).toHaveBeenCalledExactlyOnceWith('msg');
  });

  it('passes meta as a structured object', () => {
    const { mocks, logger } = setup();

    logger.info('msg', { id: 7 });

    expect(mocks.console.info).toHaveBeenCalledWith({
      message: 'msg',
      level: 'info',
      id: 7,
    });
  });

  it('merges bindings into meta', () => {
    const { mocks, logger } = setup({ bindings: { app: 'a', id: 1 } });

    logger.info('msg', { id: 2 });

    expect(mocks.console.info).toHaveBeenCalledWith({
      message: 'msg',
      level: 'info',
      app: 'a',
      id: 2,
    });
  });
});

describe('child()', () => {
  it('merges bindings and applies overrides without affecting the parent', () => {
    const { mocks, logger } = setup({ bindings: { a: 1 } });
    const child = logger.child({ b: 2 }, { level: 'debug' });

    child.debug('from child');
    logger.debug('from parent');
    logger.info('parent info');

    expect(mocks.console.info).toHaveBeenCalledTimes(2);
    expect(mocks.console.info).toHaveBeenNthCalledWith(1, {
      message: 'from child',
      level: 'debug',
      a: 1,
      b: 2,
    });
    expect(mocks.console.info).toHaveBeenNthCalledWith(2, {
      message: 'parent info',
      level: 'info',
      a: 1,
    });
  });

  it('shares the parent buffer so a parent flush clears the child view', () => {
    const { mocks, logger } = setup({ flushThreshold: 10 });
    const child = logger.child({ b: 2 });

    logger.info('parent');
    child.info('child');
    logger.flush();
    child.flush();

    expect(dataRows(logSheet(mocks.activeSpreadsheet))).toHaveLength(2);
  });
});

describe('buffering', () => {
  it('writes buffered rows in one batch once the threshold is reached', () => {
    const { mocks, logger } = setup({ flushThreshold: 3 });
    const sheet = logSheet(mocks.activeSpreadsheet);

    logger.info('1');
    logger.info('2');
    expect(dataRows(sheet)).toEqual([]);

    logger.info('3');

    const batches = sheet.calls.setValues.filter((c) => c.row > 1);
    expect(batches).toEqual([{ row: 2, col: 1, numRows: 3, numCols: 4 }]);
    expect(dataRows(sheet).map((r) => r[1])).toEqual(['1', '2', '3']);
    expect(sheet.appendRow).not.toHaveBeenCalled();
  });

  it('appends bypass levels immediately', () => {
    const { mocks, logger } = setup({
      flushThreshold: 10,
      bypassBufferLevels: ['error'],
    });
    const sheet = logSheet(mocks.activeSpreadsheet);

    logger.error('now');

    expect(sheet.appendRow).toHaveBeenCalledTimes(1);
    expect(dataRows(sheet)).toEqual([['error', 'now', '']]);
  });

  it('flush() is a no-op when the buffer is empty', () => {
    const { mocks, logger } = setup({ flushThreshold: 3 });
    const sheet = logSheet(mocks.activeSpreadsheet);

    logger.flush();

    expect(sheet.calls.setValues.filter((c) => c.row > 1)).toEqual([]);
    expect(dataRows(sheet)).toEqual([]);
  });

  it('flush() is a no-op without a sheet', () => {
    const { GasLogger } = loadGasLogger();
    const logger = new GasLogger({ flushThreshold: 3 });

    logger.info('console only');

    expect(() => logger.flush()).not.toThrow();
  });
});

describe('spreadsheet source', () => {
  it('uses the provided spreadsheet', () => {
    const { GasLogger, mocks } = loadGasLogger();
    const spreadsheet = new FakeSpreadsheet();

    new GasLogger({ sheetConfig: { spreadsheet } }).info('msg');

    expect(mocks.SpreadsheetApp.getActiveSpreadsheet).not.toHaveBeenCalled();
    expect(dataRows(logSheet(spreadsheet))).toHaveLength(1);
  });

  it('opens by url', () => {
    const { GasLogger, mocks } = loadGasLogger();
    const spreadsheet = new FakeSpreadsheet();
    mocks.SpreadsheetApp.openByUrl.mockReturnValue(spreadsheet);

    new GasLogger({ sheetConfig: { spreadsheetUrl: 'u' } }).info('msg');

    expect(mocks.SpreadsheetApp.openByUrl).toHaveBeenCalledWith('u');
    expect(dataRows(logSheet(spreadsheet))).toHaveLength(1);
  });

  it('opens by id', () => {
    const { GasLogger, mocks } = loadGasLogger();
    const spreadsheet = new FakeSpreadsheet();
    mocks.SpreadsheetApp.openById.mockReturnValue(spreadsheet);

    new GasLogger({ sheetConfig: { spreadsheetId: 'i' } }).info('msg');

    expect(mocks.SpreadsheetApp.openById).toHaveBeenCalledWith('i');
    expect(dataRows(logSheet(spreadsheet))).toHaveLength(1);
  });

  it('uses the active spreadsheet', () => {
    const { mocks, logger } = setup();

    logger.info('msg');

    expect(dataRows(logSheet(mocks.activeSpreadsheet))).toHaveLength(1);
  });

  it('throws when more than one source is given', () => {
    const { GasLogger } = loadGasLogger();

    expect(
      () =>
        new GasLogger({
          sheetConfig: { spreadsheetId: 'i', spreadsheetUrl: 'u' },
        }),
    ).toThrow(/more than one spreadsheet source/);
  });

  it('throws when there is no active spreadsheet', () => {
    const { GasLogger, mocks } = loadGasLogger();
    mocks.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(null);

    expect(
      () => new GasLogger({ sheetConfig: { useActiveSpreadsheet: true } }),
    ).toThrow(/No active spreadsheet/);
  });
});

describe('sheet resolution', () => {
  it('reuses an existing named sheet', () => {
    const { GasLogger, mocks } = loadGasLogger();
    const existing = mocks.activeSpreadsheet.insertSheet('audit');

    new GasLogger({
      sheetConfig: { useActiveSpreadsheet: true, sheetName: 'audit' },
    }).info('msg');

    expect(mocks.activeSpreadsheet.getSheets()).toEqual([existing]);
    expect(existing.values.map((row) => row[2])).toEqual(['msg']);
  });

  it('creates a new sheet with a header row', () => {
    const { mocks, logger } = setup();

    logger.info('msg');

    const sheet = logSheet(mocks.activeSpreadsheet);
    expect(sheet.values[0]).toEqual(HEADER);
    expect(sheet.setFrozenRows).toHaveBeenCalledWith(1);
  });
});
