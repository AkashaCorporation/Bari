import { describe, expect, it } from 'vitest';

import { planWindowsUserPath } from '../../src/infra/ensure-path-integration.js';

describe('planWindowsUserPath', () => {
  const tempDir = 'C:\\Users\\tester\\AppData\\Local\\Temp';
  const binDir = 'C:\\Users\\tester\\.bari\\bin';
  const smokeBin = `${tempDir}\\minimax-code-smoke-abc123\\bin`;
  const plan = (currentPath: string): string | undefined =>
    planWindowsUserPath({ currentPath, binDir, tempDir, caseInsensitive: true });

  it('prepends the bin directory when it is missing', () => {
    expect(plan('C:\\Tools;D:\\Other')).toBe(`${binDir};C:\\Tools;D:\\Other`);
  });

  it('returns undefined when the stored value is already correct', () => {
    expect(plan(binDir)).toBeUndefined();
    expect(plan(`${binDir};C:\\Tools`)).toBeUndefined();
  });

  it('prunes stale temp entries while keeping the bin directory', () => {
    expect(
      plan(`${smokeBin};${binDir};C:\\Tools;${tempDir}\\minimax-code-byok-x\\bin`),
    ).toBe(`${binDir};C:\\Tools`);
  });

  it('prunes stale temp entries and prepends the bin directory when missing', () => {
    expect(plan(`${smokeBin};C:\\Tools`)).toBe(`${binDir};C:\\Tools`);
  });

  it('collapses duplicate entries case-insensitively', () => {
    expect(plan(`${binDir};C:\\Tools;c:\\users\\tester\\.BARI\\BIN`)).toBe(`${binDir};C:\\Tools`);
  });

  it('ignores empty entries and surrounding whitespace', () => {
    expect(plan(' ;C:\\Tools; ')).toBe(`${binDir};C:\\Tools`);
  });

  it('keeps POSIX entries case-sensitive when case-insensitive planning is off', () => {
    expect(
      planWindowsUserPath({
        currentPath: '/usr/local/bin;/usr/LOCAL/bin',
        binDir: '/home/tester/.bari/bin',
        tempDir: '/tmp',
        caseInsensitive: false,
      }),
    ).toBe('/home/tester/.bari/bin;/usr/local/bin;/usr/LOCAL/bin');
  });
});
