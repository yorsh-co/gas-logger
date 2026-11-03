import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { ROOT } from './harness';

/**
 * Apps Script derives a project's OAuth scopes by scanning its code for
 * service names, so one reference here would ask every consumer for the scope
 * of that document service.
 */
const FORBIDDEN = ['SpreadsheetApp', 'DocumentApp', 'SlidesApp', 'FormApp'];

/** Every shipped `.ts` source: all of `src/` except `internal/` and `.d.ts`. */
function shippedSources(directory = join(ROOT, 'src')): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return relative(join(ROOT, 'src'), path) === 'internal'
        ? []
        : shippedSources(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
  });
}

describe('OAuth scopes', () => {
  const files = shippedSources();

  it('finds the sources to scan', () => {
    const names = files.map((file) =>
      relative(ROOT, file).split(sep).join('/'),
    );
    expect(names).toContain('src/gas-logger.class.ts');
    expect(names.some((name) => name.includes('/internal/'))).toBe(false);
    expect(names.some((name) => name.endsWith('.d.ts'))).toBe(false);
  });

  it.each(FORBIDDEN)('never names %s in the code that ships', (identifier) => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, 'utf8');
      // What is pushed is the compiled output: type-only declarations, and
      // the documentation attached to them, are erased from it.
      const shipped = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
      }).outputText;
      return new RegExp(`\\b${identifier}\\b`).test(shipped);
    });

    expect(offenders.map((file) => relative(ROOT, file))).toEqual([]);
  });

  it('catches a reference, comments included', () => {
    const shipped = ts.transpileModule(
      '// SpreadsheetApp.getUi()\nconst a = 1;',
      {
        compilerOptions: { target: ts.ScriptTarget.ES2020 },
      },
    ).outputText;

    expect(shipped).toContain('SpreadsheetApp');
  });
});
