import { describe, expect, it } from 'vitest';
import { loadGasLogger, type GasLoggerTestOptions } from './harness';
import { FakeSheet } from './mocks';

/**
 * Each `it.fails` documents a known defect and passes while the defect
 * exists. Fixing a defect turns its test red; drop `.fails` in that commit.
 */

const SHEET_NAME = 'log';

/** Loads a logger bound to a pre-created sheet in the active spreadsheet. */
function setup(options: GasLoggerTestOptions = {}) {
  const { GasLogger, mocks } = loadGasLogger();
  const sheet = mocks.activeSpreadsheet.insertSheet(SHEET_NAME);
  const logger = new GasLogger({
    sheetConfig: { useActiveSpreadsheet: true, sheetName: SHEET_NAME },
    ...options,
  });
  return { GasLogger, mocks, sheet, logger };
}

/** Message and meta cells of every populated row. */
function cells(sheet: FakeSheet, column: number): string[] {
  return sheet.values.map((row) => row[column] ?? '');
}

describe('known bugs', () => {
  it.fails('#1 reuses a single default "gas-log" tab across loggers', () => {
    const { GasLogger, mocks } = loadGasLogger();
    const config = { useActiveSpreadsheet: true };

    new GasLogger({ sheetConfig: config }).info('a');
    new GasLogger({ sheetConfig: config }).info('b');

    expect(
      mocks.activeSpreadsheet.getSheets().map((s) => s.getSheetName()),
    ).toEqual(['gas-log']);
  });

  it.fails('#2 flush holds and releases the script lock', () => {
    const { mocks, logger } = setup({ flushThreshold: 1 });

    logger.info('msg');

    expect(mocks.LockService.getScriptLock).toHaveBeenCalled();
    expect(mocks.lock.releaseLock).toHaveBeenCalled();
  });

  it.fails.each(['=', '+', '-', '@'])(
    '#3 neutralises a leading "%s" in the message cell',
    (prefix) => {
      const { sheet, logger } = setup();

      logger.info(`${prefix}SUM(A1)`);

      expect(cells(sheet, 2)).toContain(`'${prefix}SUM(A1)`);
    },
  );

  it.fails('#4a circular meta does not throw from the logger', () => {
    const { logger } = setup();
    const meta: Record<string, unknown> = {};
    meta.self = meta;

    expect(() => logger.info('msg', meta)).not.toThrow();
  });

  it.fails('#4b sheet write errors are reported, not thrown', () => {
    const { mocks, sheet, logger } = setup();
    sheet.appendRow.mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    expect(() => logger.error('msg')).not.toThrow();
    expect(mocks.console.error).toHaveBeenCalledWith(
      expect.stringContaining('[GasLogger]'),
    );
  });

  it.fails('#4c truncates messages to the 50000 character cell limit', () => {
    const { sheet, logger } = setup();

    logger.info('a'.repeat(60000));

    expect(cells(sheet, 2)[0]?.length).toBeLessThanOrEqual(50000);
  });

  it.fails('#5 serialises Error values in meta', () => {
    const { mocks, sheet, logger } = setup();

    logger.error('msg', { err: new Error('boom') });

    const json = cells(sheet, 3)[0];
    expect(json).toContain('"message":"boom"');
    expect(json).toContain('"stack"');
    expect(mocks.console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({ message: 'boom' }),
      }),
    );
  });

  it.fails('#6 meta cannot override the console message and level', () => {
    const { mocks, logger } = setup();

    logger.info('real', { message: 'x', level: 'y' });

    expect(mocks.console.info).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'real', level: 'info' }),
    );
  });

  it.fails.each([
    ['fatal', 'error'],
    ['debug', 'info'],
    ['trace', 'info'],
  ] as const)(
    '#7 %s without meta is emitted as a structured payload via console.%s',
    (level, method) => {
      const { mocks, logger } = setup({ level: 'trace' });

      logger[level]('x');

      expect(mocks.console[method]).toHaveBeenCalledWith({
        message: 'x',
        level,
      });
    },
  );

  it.fails('#8 bypass entries do not jump ahead of buffered rows', () => {
    const { sheet, logger } = setup({
      flushThreshold: 10,
      bypassBufferLevels: ['error'],
    });

    logger.info('a');
    logger.info('b');
    logger.error('c');
    logger.flush();

    expect(cells(sheet, 2)).toEqual(['a', 'b', 'c']);
  });

  it.fails(
    '#9a opens the spreadsheet on first write, not in the constructor',
    () => {
      const { GasLogger, mocks } = loadGasLogger();

      const logger = new GasLogger({
        sheetConfig: { useActiveSpreadsheet: true },
      });
      expect(mocks.SpreadsheetApp.getActiveSpreadsheet).not.toHaveBeenCalled();

      logger.info('msg');
      expect(mocks.SpreadsheetApp.getActiveSpreadsheet).toHaveBeenCalled();
    },
  );

  it.fails(
    '#9b a failing spreadsheet source does not throw from the constructor',
    () => {
      const { GasLogger, mocks } = loadGasLogger();
      mocks.SpreadsheetApp.openById.mockImplementation(() => {
        throw new Error('No item with the given ID could be found.');
      });

      expect(
        () => new GasLogger({ sheetConfig: { spreadsheetId: 'missing' } }),
      ).not.toThrow();
    },
  );

  it.fails(
    '#10a an empty sheetConfig enables the sheet on the active spreadsheet',
    () => {
      const { GasLogger, mocks } = loadGasLogger();

      new GasLogger({ sheetConfig: {} }).info('msg');

      expect(mocks.activeSpreadsheet.getSheets()).toHaveLength(1);
    },
  );

  it.fails(
    '#10b useActiveSpreadsheet: false without another source throws',
    () => {
      const { GasLogger } = loadGasLogger();

      expect(
        () => new GasLogger({ sheetConfig: { useActiveSpreadsheet: false } }),
      ).toThrow();
    },
  );

  it.fails(
    '#11 falls back to a sheet created concurrently by another execution',
    () => {
      const { GasLogger, mocks } = loadGasLogger();
      const existing = mocks.activeSpreadsheet.insertSheet(SHEET_NAME);
      mocks.activeSpreadsheet.getSheetByName.mockReturnValueOnce(null);

      new GasLogger({
        sheetConfig: { useActiveSpreadsheet: true, sheetName: SHEET_NAME },
      }).info('msg');

      expect(cells(existing, 2)).toContain('msg');
    },
  );

  it.fails('#12 applies banding to the four log columns only', () => {
    const { GasLogger, mocks } = loadGasLogger();

    new GasLogger({
      sheetConfig: { useActiveSpreadsheet: true, sheetName: SHEET_NAME },
    }).info('msg');

    const sheet = mocks.activeSpreadsheet.getSheets()[0];
    expect(sheet?.calls.applyRowBanding[0]?.numCols).toBe(4);
  });

  it.fails('#20 buffered flush grows a full sheet instead of throwing', () => {
    const { sheet, logger } = setup({ flushThreshold: 2 });
    sheet.values = [['h'], ['x'], ['y']];
    sheet.maxRows = 3;

    expect(() => {
      logger.info('a');
      logger.info('b');
    }).not.toThrow();
    expect(cells(sheet, 2).slice(3)).toEqual(['a', 'b']);
  });
});
