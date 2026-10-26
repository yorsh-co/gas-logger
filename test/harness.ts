import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { createMocks, type Mocks } from './mocks';

type Level = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
type Meta = Record<string, unknown>;

/** Loose, test-side view of the `GasLogger` options. */
export interface GasLoggerTestOptions {
  level?: Level;
  sheetLevel?: Level;
  sheetConfig?: Record<string, unknown>;
  bindings?: Meta;
  flushThreshold?: number;
  bypassBufferLevels?: Level[];
}

export interface GasLoggerInstance {
  trace(msg: string, meta?: Meta): void;
  debug(msg: string, meta?: Meta): void;
  info(msg: string, meta?: Meta): void;
  warn(msg: string, meta?: Meta): void;
  error(msg: string, meta?: Meta): void;
  fatal(msg: string, meta?: Meta): void;
  child(
    bindings?: Meta,
    overrides?: { level?: Level; sheetLevel?: Level },
  ): GasLoggerInstance;
  flush(): void;
}

export type GasLoggerConstructor = new (
  options?: GasLoggerTestOptions,
) => GasLoggerInstance;

/** Source files in load order; later files depend on earlier ones. */
const SOURCE_FILES = [
  'gas-logger.types.ts',
  'gas-logger.constants.ts',
  'gas-logger.class.ts',
];

/**
 * The sources are global-scope scripts without exports, so they are
 * transpiled once and concatenated into a single script.
 */
const script = new vm.Script(
  SOURCE_FILES.map((file) => {
    const source = readFileSync(
      fileURLToPath(new URL(`../src/${file}`, import.meta.url)),
      'utf8',
    );
    return ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2021 },
    }).outputText;
  }).join('\n') + '\nGasLogger;',
);

/**
 * Evaluates the logger sources in a fresh context wired to fake Apps Script
 * services, so each call is isolated from every other.
 */
export function loadGasLogger(overrides: Partial<Mocks> = {}): {
  GasLogger: GasLoggerConstructor;
  mocks: Mocks;
} {
  const mocks = { ...createMocks(), ...overrides };
  const { SpreadsheetApp, LockService, Logger, console } = mocks;
  const context = vm.createContext({
    SpreadsheetApp,
    LockService,
    Logger,
    console,
  });

  return {
    GasLogger: script.runInContext(context) as GasLoggerConstructor,
    mocks,
  };
}
