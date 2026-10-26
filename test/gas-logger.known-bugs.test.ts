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
});
