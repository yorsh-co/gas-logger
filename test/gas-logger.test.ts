import { describe, expect, it, vi } from 'vitest';
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
    ['info', 'info'],
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const)('maps %s to console.%s as a plain string', (level, method) => {
    const { mocks, logger } = setup({ level: 'trace' });

    logger[level]('msg');

    expect(mocks.console[method]).toHaveBeenCalledExactlyOnceWith('msg');
  });

  it.each([
    ['trace', 'info'],
    ['debug', 'info'],
    ['fatal', 'error'],
  ] as const)(
    'maps %s to console.%s with the real level in the payload',
    (level, method) => {
      const { mocks, logger } = setup({ level: 'trace' });

      logger[level]('msg');

      expect(mocks.console[method]).toHaveBeenCalledExactlyOnceWith({
        message: 'msg',
        level,
      });
    },
  );

  it('does not let meta override the message and level', () => {
    const { mocks, logger } = setup();

    logger.info('real', { message: 'x', level: 'y' });

    expect(mocks.console.info).toHaveBeenCalledWith({
      message: 'real',
      level: 'info',
    });
  });

  it('does not let child bindings override the message and level', () => {
    const { mocks, logger } = setup();

    logger.child({ message: 'x', level: 'y' }).info('real');

    expect(mocks.console.info).toHaveBeenCalledWith({
      message: 'real',
      level: 'info',
    });
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

  it('writes bypass levels immediately', () => {
    const { mocks, logger } = setup({
      flushThreshold: 10,
      bypassBufferLevels: ['error'],
    });

    logger.error('now');
    const sheet = logSheet(mocks.activeSpreadsheet);

    expect(sheet.appendRow).not.toHaveBeenCalled();
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

  it('applies banding and the bold header to the log columns only', () => {
    const { mocks, logger } = setup();

    logger.info('msg');

    const sheet = logSheet(mocks.activeSpreadsheet);
    expect(sheet.maxColumns).toBeGreaterThan(HEADER.length);
    expect(sheet.calls.applyRowBanding).toEqual([
      expect.objectContaining({ col: 1, numCols: HEADER.length }),
    ]);
    expect(sheet.calls.setFontWeight).toEqual([
      expect.objectContaining({ col: 1, numRows: 1, numCols: HEADER.length }),
    ]);
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

/** Cells of the given column across every populated row. */
function column(sheet: FakeSheet, index: number): string[] {
  return sheet.values.map((row) => row[index] ?? '');
}

/** Loads a logger bound to a pre-created sheet. */
function setupOnSheet(options: GasLoggerTestOptions = {}) {
  const { GasLogger, mocks } = loadGasLogger();
  const sheet = mocks.activeSpreadsheet.insertSheet('log');
  const logger = new GasLogger({
    sheetConfig: { useActiveSpreadsheet: true, sheetName: 'log' },
    ...options,
  });
  return { mocks, sheet, logger };
}

/** Like `setupOnSheet`, with buffering enabled unless overridden. */
function setupBuffered(options: GasLoggerTestOptions = {}) {
  return setupOnSheet({ flushThreshold: 10, ...options });
}

/** `[GasLogger]` reports sent to `console.error`. */
function reports(mocks: ReturnType<typeof loadGasLogger>['mocks']) {
  return mocks.console.error.mock.calls.filter(
    ([first]) => typeof first === 'string' && first.startsWith('[GasLogger]'),
  );
}

describe('flush locking', () => {
  it('holds and releases the script lock around the write', () => {
    const { mocks, logger } = setupBuffered({ flushThreshold: 1 });

    logger.info('msg');

    expect(mocks.lock.tryLock).toHaveBeenCalledWith(10000);
    expect(mocks.lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('releases the lock when setValues throws', () => {
    const { mocks, sheet, logger } = setupBuffered();
    sheet.getRange = () => {
      throw new Error('boom');
    };

    logger.info('msg');
    expect(() => logger.flush()).not.toThrow();

    expect(mocks.lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('reports a lock timeout with the row count, drops the rows and keeps the sink enabled', () => {
    const { mocks, sheet, logger } = setupBuffered();
    mocks.lock.tryLock.mockReturnValueOnce(false);

    logger.info('a');
    logger.info('b');
    expect(() => logger.flush()).not.toThrow();

    expect(mocks.console.error).toHaveBeenCalledExactlyOnceWith(
      '[GasLogger] Failed to write 2 row(s) to the log sheet.',
      expect.objectContaining({
        message: expect.stringContaining('script lock'),
      }),
    );
    expect(mocks.lock.releaseLock).not.toHaveBeenCalled();
    expect(column(sheet, 2)).toEqual([]);

    logger.info('c');
    logger.flush();

    expect(column(sheet, 2)).toEqual(['c']);
  });

  it('does not re-write the rows of a failed flush later', () => {
    const { mocks, sheet, logger } = setupBuffered();
    const getRange = sheet.getRange;
    sheet.getRange = () => {
      throw new Error('quota exceeded');
    };

    logger.info('lost');
    logger.flush();
    sheet.getRange = getRange;
    logger.info('kept');
    logger.flush();

    expect(reports(mocks)).toHaveLength(1);
    expect(column(sheet, 2)).toEqual(['kept']);
  });

  it('takes no lock for individual appends', () => {
    const { mocks, sheet, logger } = setupOnSheet();

    logger.info('msg');

    expect(sheet.appendRow).toHaveBeenCalledTimes(1);
    expect(mocks.LockService.getScriptLock).not.toHaveBeenCalled();
  });
});

describe('sheet capacity', () => {
  it('grows a full sheet instead of throwing', () => {
    const { sheet, logger } = setupBuffered({ flushThreshold: 2 });
    sheet.values = [['h'], ['x'], ['y']];
    sheet.maxRows = 3;

    expect(() => {
      logger.info('a');
      logger.info('b');
    }).not.toThrow();

    expect(column(sheet, 2).slice(3)).toEqual(['a', 'b']);
  });

  it('inserts exactly the missing rows after the last grid row', () => {
    const { sheet, logger } = setupBuffered({ flushThreshold: 2 });
    const insert = vi.spyOn(sheet, 'insertRowsAfter');
    sheet.values = [['h'], ['x'], ['y']];
    sheet.maxRows = 3;

    logger.info('a');
    logger.info('b');

    expect(insert).toHaveBeenCalledExactlyOnceWith(3, 2);
    expect(sheet.maxRows).toBe(5);
  });

  it('inserts only the shortfall when the batch partly fits', () => {
    const { sheet, logger } = setupBuffered({ flushThreshold: 3 });
    const insert = vi.spyOn(sheet, 'insertRowsAfter');
    sheet.values = [['h'], ['x']];
    sheet.maxRows = 3;

    logger.info('a');
    logger.info('b');
    logger.info('c');

    expect(insert).toHaveBeenCalledExactlyOnceWith(3, 2);
    expect(column(sheet, 2).slice(2)).toEqual(['a', 'b', 'c']);
  });

  it('does not insert rows when the batch fits', () => {
    const { sheet, logger } = setupBuffered({ flushThreshold: 2 });
    const insert = vi.spyOn(sheet, 'insertRowsAfter');

    logger.info('a');
    logger.info('b');

    expect(insert).not.toHaveBeenCalled();
  });
});

describe('bypass ordering', () => {
  it('writes a bypass entry after the pending rows in a single batch', () => {
    const { sheet, logger } = setupBuffered({ bypassBufferLevels: ['error'] });

    logger.info('a');
    logger.info('b');
    logger.error('c');

    expect(column(sheet, 2)).toEqual(['a', 'b', 'c']);
    expect(sheet.calls.setValues).toEqual([
      { row: 1, col: 1, numRows: 3, numCols: 4 },
    ]);
    expect(sheet.appendRow).not.toHaveBeenCalled();
  });

  it('writes a bypass entry as a one-row batch when the buffer is empty', () => {
    const { sheet, logger } = setupBuffered({ bypassBufferLevels: ['error'] });

    logger.error('c');

    expect(sheet.calls.setValues).toEqual([
      { row: 1, col: 1, numRows: 1, numCols: 4 },
    ]);
    expect(sheet.appendRow).not.toHaveBeenCalled();
  });

  it('takes the script lock for a bypass entry', () => {
    const { mocks, logger } = setupBuffered({ bypassBufferLevels: ['error'] });

    logger.error('c');

    expect(mocks.lock.tryLock).toHaveBeenCalledWith(10000);
    expect(mocks.lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  it('flushes the shared buffer when a child logs a bypass entry', () => {
    const { sheet, logger } = setupBuffered({ bypassBufferLevels: ['error'] });
    const child = logger.child({ b: 2 });

    logger.info('a');
    child.error('c');

    expect(column(sheet, 2)).toEqual(['a', 'c']);
    expect(sheet.calls.setValues).toHaveLength(1);

    logger.flush();
    expect(column(sheet, 2)).toEqual(['a', 'c']);
  });

  it('reports pending and bypass rows together when the batch fails', () => {
    const { mocks, sheet, logger } = setupBuffered({
      bypassBufferLevels: ['error'],
    });
    sheet.getRange = () => {
      throw new Error('boom');
    };

    logger.info('a');
    expect(() => logger.error('c')).not.toThrow();

    expect(mocks.console.error).toHaveBeenCalledWith(
      '[GasLogger] Failed to write 2 row(s) to the log sheet.',
      expect.any(Error),
    );
  });
});

describe('sheet write failures', () => {
  it('reports a failed append without throwing', () => {
    const { mocks, sheet, logger } = setupOnSheet();
    const error = new Error('quota exceeded');
    sheet.appendRow.mockImplementation(() => {
      throw error;
    });

    expect(() => logger.error('msg')).not.toThrow();

    expect(mocks.console.error).toHaveBeenCalledWith(
      '[GasLogger] Failed to write 1 row(s) to the log sheet.',
      error,
    );
  });

  it('keeps writing after a failed append', () => {
    const { sheet, logger } = setupOnSheet();
    sheet.appendRow.mockImplementationOnce(() => {
      throw new Error('transient');
    });

    logger.info('lost');
    logger.info('kept');

    expect(column(sheet, 2)).toEqual(['kept']);
  });

  it('reports a failed batch with its row count', () => {
    const { mocks, sheet, logger } = setupBuffered({ flushThreshold: 3 });
    const error = new Error('boom');
    sheet.getRange = () => {
      throw error;
    };

    logger.info('a');
    logger.info('b');
    expect(() => logger.info('c')).not.toThrow();

    expect(mocks.console.error).toHaveBeenCalledWith(
      '[GasLogger] Failed to write 3 row(s) to the log sheet.',
      error,
    );
  });
});

describe('meta normalization', () => {
  it('replaces circular references with "[Circular]"', () => {
    const { mocks, sheet, logger } = setupOnSheet();
    const meta: Record<string, unknown> = { id: 1 };
    meta.self = meta;

    expect(() => logger.info('msg', meta)).not.toThrow();

    expect(JSON.parse(column(sheet, 3)[0] ?? '')).toEqual({
      id: 1,
      self: '[Circular]',
    });
    expect(mocks.console.info).toHaveBeenCalledWith({
      message: 'msg',
      level: 'info',
      id: 1,
      self: '[Circular]',
    });
  });

  it('replaces a circular reference nested in an array', () => {
    const { sheet, logger } = setupOnSheet();
    const list: unknown[] = [1];
    list.push({ list });

    logger.info('msg', { list });

    expect(JSON.parse(column(sheet, 3)[0] ?? '')).toEqual({
      list: [1, { list: '[Circular]' }],
    });
  });

  it('serializes an object referenced twice without a cycle', () => {
    const { sheet, logger } = setupOnSheet();
    const shared = { a: 1 };

    logger.info('msg', { first: shared, second: shared, both: [shared] });

    expect(JSON.parse(column(sheet, 3)[0] ?? '')).toEqual({
      first: { a: 1 },
      second: { a: 1 },
      both: [{ a: 1 }],
    });
  });

  it('serializes Error values in meta for the sheet and the console', () => {
    const { mocks, sheet, logger } = setupOnSheet();

    logger.error('msg', { err: new Error('boom') });

    const parsed = JSON.parse(column(sheet, 3)[0] ?? '');
    expect(parsed.err).toEqual({
      name: 'Error',
      message: 'boom',
      stack: expect.stringContaining('boom'),
    });
    expect(mocks.console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ name: 'Error', message: 'boom' }),
      }),
    );
  });

  it('keeps extra enumerable properties and normalizes a nested cause', () => {
    const { sheet, logger } = setupOnSheet();
    const err = Object.assign(new TypeError('outer'), {
      code: 'E_FAIL',
      cause: new Error('inner'),
    });

    logger.error('msg', { err });

    const parsed = JSON.parse(column(sheet, 3)[0] ?? '');
    expect(parsed.err).toMatchObject({
      name: 'TypeError',
      message: 'outer',
      code: 'E_FAIL',
      cause: { name: 'Error', message: 'inner' },
    });
  });

  it('serializes an Error passed through child bindings', () => {
    const { sheet, logger } = setupOnSheet();

    logger.child({ err: new Error('bound') }).info('msg');

    expect(JSON.parse(column(sheet, 3)[0] ?? '').err).toMatchObject({
      message: 'bound',
    });
  });

  it('serializes bigint values as strings', () => {
    const { mocks, sheet, logger } = setupOnSheet();

    expect(() => logger.info('msg', { big: 10n ** 20n })).not.toThrow();

    expect(JSON.parse(column(sheet, 3)[0] ?? '')).toEqual({
      big: '100000000000000000000',
    });
    expect(mocks.console.info).toHaveBeenCalledWith(
      expect.objectContaining({ big: '100000000000000000000' }),
    );
  });

  it('keeps dates as dates', () => {
    const { sheet, logger } = setupOnSheet();
    const at = new Date('2026-01-02T03:04:05.000Z');

    logger.info('msg', { at });

    expect(JSON.parse(column(sheet, 3)[0] ?? '')).toEqual({
      at: '2026-01-02T03:04:05.000Z',
    });
  });
});

describe('sheet cell safety', () => {
  const LIMIT = 50000;

  it('leaves an ordinary message unchanged', () => {
    const { sheet, logger } = setupOnSheet();

    logger.info('hello');

    expect(column(sheet, 2)).toEqual(['hello']);
  });

  it.each(['=', '+', '-', '@'])(
    'stores a message starting with "%s" as text',
    (prefix) => {
      const { sheet, logger } = setupOnSheet();

      logger.info(`${prefix}SUM(A1)`);

      expect(column(sheet, 2)).toEqual([`'${prefix}SUM(A1)`]);
    },
  );

  it('stores a negative-number-like message as text', () => {
    const { sheet, logger } = setupOnSheet();

    logger.info('-5');

    expect(column(sheet, 2)).toEqual(["'-5"]);
  });

  it('does not prefix a message already starting with a quote', () => {
    const { sheet, logger } = setupOnSheet();

    logger.info("'quoted");

    expect(column(sheet, 2)).toEqual(["'quoted"]);
  });

  it('truncates a long message to the cell limit with a marker', () => {
    const { sheet, logger } = setupOnSheet();

    logger.info('a'.repeat(LIMIT + 10));

    const cell = column(sheet, 2)[0] ?? '';
    expect(cell).toHaveLength(LIMIT);
    expect(cell.endsWith('…[truncated]')).toBe(true);
  });

  it('keeps a message of exactly the limit untouched', () => {
    const { sheet, logger } = setupOnSheet();

    logger.info('a'.repeat(LIMIT));

    expect(column(sheet, 2)[0]).toBe('a'.repeat(LIMIT));
  });

  it('truncates meta_json to the cell limit with a marker', () => {
    const { sheet, logger } = setupOnSheet();

    logger.info('msg', { blob: 'b'.repeat(LIMIT * 2) });

    const cell = column(sheet, 3)[0] ?? '';
    expect(cell).toHaveLength(LIMIT);
    expect(cell.endsWith('…[truncated]')).toBe(true);
  });

  it('keeps an escaped and truncated message within the limit', () => {
    const { sheet, logger } = setupOnSheet();

    logger.info(`=${'a'.repeat(LIMIT)}`);

    const cell = column(sheet, 2)[0] ?? '';
    expect(cell.startsWith("'=")).toBe(true);
    expect(cell).toHaveLength(LIMIT);
    expect(cell.endsWith('…[truncated]')).toBe(true);
  });

  it('sends the full untruncated message to the console', () => {
    const { mocks, logger } = setupOnSheet();
    const message = `=${'a'.repeat(LIMIT * 2)}`;

    logger.info(message);

    expect(mocks.console.info).toHaveBeenCalledWith(message);
  });
});
