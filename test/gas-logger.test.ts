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
    expect(mocks.activeSpreadsheet.getSheets()).toEqual([]);
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

    logger.info('1');
    const sheet = logSheet(mocks.activeSpreadsheet);
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

    logger.error('now');
    const sheet = logSheet(mocks.activeSpreadsheet);

    expect(sheet.appendRow).toHaveBeenCalledTimes(1);
    expect(dataRows(sheet)).toEqual([['error', 'now', '']]);
  });

  it('flush() is a no-op when the buffer is empty', () => {
    const { mocks, logger } = setup({ flushThreshold: 3 });

    logger.flush();

    expect(mocks.activeSpreadsheet.getSheets()).toEqual([]);
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

  it('reports and disables the sheet sink when there is no active spreadsheet', () => {
    const { GasLogger, mocks } = loadGasLogger();
    mocks.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(null);
    const logger = new GasLogger({
      sheetConfig: { useActiveSpreadsheet: true },
    });

    expect(() => logger.info('msg')).not.toThrow();

    expect(mocks.console.error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining('[GasLogger]'),
      expect.objectContaining({
        message: expect.stringContaining('No active spreadsheet'),
      }),
    );
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

describe('lazy sheet resolution', () => {
  it('opens the spreadsheet on first write, not in the constructor', () => {
    const { GasLogger, mocks } = loadGasLogger();

    const logger = new GasLogger({
      sheetConfig: { useActiveSpreadsheet: true },
    });
    expect(mocks.SpreadsheetApp.getActiveSpreadsheet).not.toHaveBeenCalled();
    expect(mocks.LockService.getScriptLock).not.toHaveBeenCalled();

    logger.info('msg');
    expect(mocks.SpreadsheetApp.getActiveSpreadsheet).toHaveBeenCalled();
  });

  it('does not throw from the constructor when the source fails', () => {
    const { GasLogger, mocks } = loadGasLogger();
    mocks.SpreadsheetApp.openById.mockImplementation(() => {
      throw new Error('No item with the given ID could be found.');
    });

    expect(
      () => new GasLogger({ sheetConfig: { spreadsheetId: 'missing' } }),
    ).not.toThrow();
  });

  it('reports a resolution failure once and does not retry', () => {
    const { GasLogger, mocks } = loadGasLogger();
    mocks.SpreadsheetApp.openById.mockImplementation(() => {
      throw new Error('boom');
    });
    const logger = new GasLogger({
      level: 'fatal',
      sheetConfig: { spreadsheetId: 'missing' },
    });

    logger.fatal('first');
    logger.fatal('second');

    expect(mocks.SpreadsheetApp.openById).toHaveBeenCalledTimes(1);
    const reports = mocks.console.error.mock.calls.filter(
      ([first]) => typeof first === 'string' && first.startsWith('[GasLogger]'),
    );
    expect(reports).toHaveLength(1);
  });

  it('keeps logging to the console after the sheet sink is disabled', () => {
    const { GasLogger, mocks } = loadGasLogger();
    mocks.SpreadsheetApp.getActiveSpreadsheet.mockReturnValue(null);
    const logger = new GasLogger({ sheetConfig: {} });

    logger.info('first');
    logger.info('second');

    expect(mocks.console.info).toHaveBeenNthCalledWith(1, 'first');
    expect(mocks.console.info).toHaveBeenNthCalledWith(2, 'second');
  });

  it('does not resolve the sheet for entries below sheetLevel', () => {
    const { GasLogger, mocks } = loadGasLogger();
    const logger = new GasLogger({
      sheetLevel: 'error',
      sheetConfig: { useActiveSpreadsheet: true },
    });

    logger.info('console only');
    expect(mocks.SpreadsheetApp.getActiveSpreadsheet).not.toHaveBeenCalled();

    logger.error('sheet');
    expect(mocks.SpreadsheetApp.getActiveSpreadsheet).toHaveBeenCalledTimes(1);
  });

  it('shares the sheet resolved by the parent with a child created earlier', () => {
    const { mocks, logger } = setup();
    const child = logger.child({ b: 2 });

    logger.info('parent');
    child.info('child');

    expect(mocks.SpreadsheetApp.getActiveSpreadsheet).toHaveBeenCalledTimes(1);
    expect(mocks.activeSpreadsheet.getSheets()).toHaveLength(1);
    expect(dataRows(logSheet(mocks.activeSpreadsheet))).toHaveLength(2);
  });
});

describe('sheetConfig semantics', () => {
  it('an empty sheetConfig enables the sheet on the active spreadsheet', () => {
    const { GasLogger, mocks } = loadGasLogger();

    new GasLogger({ sheetConfig: {} }).info('msg');

    expect(mocks.activeSpreadsheet.getSheets()).toHaveLength(1);
  });

  it('throws when useActiveSpreadsheet is false without another source', () => {
    const { GasLogger } = loadGasLogger();

    expect(
      () => new GasLogger({ sheetConfig: { useActiveSpreadsheet: false } }),
    ).toThrow(/\[GasLogger\].*source is required/);
  });
});

describe('default sheet', () => {
  it('reuses a single default "gas-log" tab across loggers', () => {
    const { GasLogger, mocks } = loadGasLogger();
    const config = { useActiveSpreadsheet: true };

    new GasLogger({ sheetConfig: config }).info('a');
    new GasLogger({ sheetConfig: config }).info('b');

    expect(
      mocks.activeSpreadsheet.getSheets().map((s) => s.getSheetName()),
    ).toEqual(['gas-log']);
  });
});

describe('sheet creation lock', () => {
  it('falls back to a sheet created concurrently by another execution', () => {
    const { GasLogger, mocks } = loadGasLogger();
    const existing = mocks.activeSpreadsheet.insertSheet('log');
    mocks.activeSpreadsheet.getSheetByName.mockReturnValueOnce(null);

    new GasLogger({
      sheetConfig: { useActiveSpreadsheet: true, sheetName: 'log' },
    }).info('msg');

    expect(existing.values.map((row) => row[2])).toContain('msg');
  });

  it('takes the lock only when a sheet needs creating', () => {
    const { GasLogger, mocks } = loadGasLogger();
    mocks.activeSpreadsheet.insertSheet('gas-log');

    new GasLogger({ sheetConfig: {} }).info('msg');

    expect(mocks.LockService.getScriptLock).not.toHaveBeenCalled();
  });

  it('releases the lock when insertSheet throws', () => {
    const { mocks, logger } = setup();
    mocks.activeSpreadsheet.insertSheet.mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => logger.info('msg')).not.toThrow();

    expect(mocks.lock.tryLock).toHaveBeenCalledWith(10000);
    expect(mocks.lock.releaseLock).toHaveBeenCalledTimes(1);
    expect(mocks.console.error).toHaveBeenCalledWith(
      expect.stringContaining('[GasLogger]'),
      expect.any(Error),
    );
  });

  it('reports a lock timeout without throwing or creating the sheet', () => {
    const { mocks, logger } = setup();
    mocks.lock.tryLock.mockReturnValue(false);

    expect(() => logger.info('msg')).not.toThrow();

    expect(mocks.activeSpreadsheet.insertSheet).not.toHaveBeenCalled();
    expect(mocks.lock.releaseLock).not.toHaveBeenCalled();
    expect(mocks.console.error).toHaveBeenCalledWith(
      expect.stringContaining('[GasLogger]'),
      expect.objectContaining({
        message: expect.stringContaining('script lock'),
      }),
    );
  });
});
