import { fileURLToPath } from 'node:url';
import { createGasLoader, loadOrderFiles } from 'gas-dev-config/test';
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
  lockService?: unknown;
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

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Source files in load order, from `gasDevConfig.loadOrder`. */
export const SOURCE_FILES = loadOrderFiles(ROOT);

const load = createGasLoader<{ GasLogger: GasLoggerConstructor }>({
  files: SOURCE_FILES,
  exports: ['GasLogger'],
  root: ROOT,
});

/**
 * Evaluates the logger sources in a fresh context wired to fake Apps Script
 * services, so each call is isolated from every other.
 */
export function loadGasLogger(
  overrides: Partial<Mocks> = {},
  globals: Record<string, unknown> = {},
): {
  GasLogger: GasLoggerConstructor;
  mocks: Mocks;
} {
  const mocks = { ...createMocks(), ...overrides };
  const { SpreadsheetApp, LockService, Logger, console } = mocks;
  return {
    GasLogger: load({
      SpreadsheetApp,
      LockService,
      Logger,
      console,
      ...globals,
    }).GasLogger,
    mocks,
  };
}
