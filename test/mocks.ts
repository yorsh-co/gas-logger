import { vi } from 'vitest';

type Row = string[];

/** Coordinates and values recorded for a range operation. */
interface RangeCall {
  row: number;
  col: number;
  numRows: number;
  numCols: number;
}

const OUT_OF_BOUNDS_MESSAGE =
  'The coordinates of the range are outside the dimensions of the sheet.';

/**
 * In-memory stand-in for an Apps Script `Sheet`, enforcing the grid
 * limits that make `getRange` throw on real sheets.
 */
export class FakeSheet {
  values: Row[] = [];
  maxRows = 1000;
  maxColumns = 26;
  readonly calls = {
    setValues: [] as RangeCall[],
    setFontWeight: [] as RangeCall[],
    applyRowBanding: [] as RangeCall[],
  };

  constructor(private readonly name: string) {}

  getSheetName = (): string => this.name;

  getMaxRows = (): number => this.maxRows;

  getMaxColumns = (): number => this.maxColumns;

  getLastRow = (): number => {
    for (let i = this.values.length - 1; i >= 0; i--) {
      if (this.values[i]?.some((cell) => cell !== '')) return i + 1;
    }
    return 0;
  };

  appendRow = vi.fn((row: Row): this => {
    const target = this.getLastRow() + 1;
    this.maxRows = Math.max(this.maxRows, target);
    this.values[target - 1] = [...row];
    return this;
  });

  insertRowsAfter = (afterPosition: number, howMany: number): this => {
    void afterPosition;
    this.maxRows += howMany;
    return this;
  };

  getRange = (
    row: number,
    col: number,
    numRows = 1,
    numCols = 1,
  ): FakeRange => {
    if (
      row < 1 ||
      col < 1 ||
      row + numRows - 1 > this.maxRows ||
      col + numCols - 1 > this.maxColumns
    ) {
      throw new Error(OUT_OF_BOUNDS_MESSAGE);
    }
    return new FakeRange(this, { row, col, numRows, numCols });
  };

  setFrozenRows = vi.fn();

  getBandings = (): unknown[] => [];
}

/** Range handle returned by `FakeSheet.getRange`. */
export class FakeRange {
  constructor(
    private readonly sheet: FakeSheet,
    private readonly coords: RangeCall,
  ) {}

  setValues(values: Row[]): this {
    const { row, col, numRows, numCols } = this.coords;
    if (values.length !== numRows || values.some((r) => r.length !== numCols)) {
      throw new Error(
        `The number of rows or columns in the data does not match the number of rows or columns in the range. The data has ${values.length} rows but the range has ${numRows} rows.`,
      );
    }
    values.forEach((rowValues, i) => {
      const target = (this.sheet.values[row - 1 + i] ??= []);
      rowValues.forEach((value, j) => {
        target[col - 1 + j] = value;
      });
    });
    this.sheet.calls.setValues.push(this.coords);
    return this;
  }

  setFontWeight(weight: string): this {
    void weight;
    this.sheet.calls.setFontWeight.push(this.coords);
    return this;
  }

  applyRowBanding(): { getRange: () => FakeRange; setRange: () => void } {
    this.sheet.calls.applyRowBanding.push(this.coords);
    return { getRange: () => this, setRange: () => undefined };
  }
}

/** In-memory stand-in for an Apps Script `Spreadsheet`. */
export class FakeSpreadsheet {
  private readonly sheets: FakeSheet[] = [];

  getSheets = (): FakeSheet[] => [...this.sheets];

  getSheetByName = vi.fn(
    (name: string): FakeSheet | null =>
      this.sheets.find((s) => s.getSheetName() === name) ?? null,
  );

  insertSheet = vi.fn((name: string): FakeSheet => {
    if (this.sheets.some((s) => s.getSheetName() === name)) {
      throw new Error(
        `A sheet with the name "${name}" already exists. Please enter another name.`,
      );
    }
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  });
}

/** Fresh set of Apps Script service fakes injected as globals. */
export function createMocks() {
  const activeSpreadsheet = new FakeSpreadsheet();
  const lock = {
    tryLock: vi.fn((timeoutInMillis: number): boolean => {
      void timeoutInMillis;
      return true;
    }),
    waitLock: vi.fn(),
    releaseLock: vi.fn(),
    hasLock: vi.fn(() => true),
  };

  return {
    activeSpreadsheet,
    lock,
    SpreadsheetApp: {
      getActiveSpreadsheet: vi.fn(
        (): FakeSpreadsheet | null => activeSpreadsheet,
      ),
      openById: vi.fn((id: string): FakeSpreadsheet => {
        throw new Error(`Unexpected openById("${id}")`);
      }),
      openByUrl: vi.fn((url: string): FakeSpreadsheet => {
        throw new Error(`Unexpected openByUrl("${url}")`);
      }),
    },
    LockService: { getScriptLock: vi.fn(() => lock) },
    Logger: { log: vi.fn() },
    console: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    },
  };
}

export type Mocks = ReturnType<typeof createMocks>;
