import { describe, expect, it } from 'vitest';

import { planWindowsUserPath } from '../../src/infra/ensure-path-integration.js';

describe('planWindowsUserPath', () => {
  const tempDir = 'C:\\Users\\tester\\AppData\\Local\\Temp';
  const binDir = 'C:\\Users\\tester\\.bari\\bin';
  const smokeBin = `${tempDir}\\minimax-code-smoke-abc123\\bin`;

  it('prepends the bin directory when it is missing', () => {
    expect(planWindowsUserPath({ currentPath: 'C:\\Tools;D:\\Other', binDir, tempDir })).toBe(
      `${binDir};C:\\Tools;D:\\Other`,
    );
  });

  it('returns undefined when the stored value is already correct', () => {
    expect(planWindowsUserPath({ currentPath: binDir, binDir, tempDir })).toBeUndefined();
    expect(
      planWindowsUserPath({ currentPath: `${binDir};C:\\Tools`, binDir, tempDir }),
    ).toBeUndefined();
  });

  it('prunes stale temp entries while keeping the bin directory', () => {
    expect(
      planWindowsUserPath({
        currentPath: `${smokeBin};${binDir};C:\\Tools;${tempDir}\\minimax-code-byok-x\\bin`,
        binDir,
        tempDir,
      }),
    ).toBe(`${binDir};C:\\Tools`);
  });

  it('prunes stale temp entries and prepends the bin directory when missing', () => {
    expect(
      planWindowsUserPath({
        currentPath: `${smokeBin};C:\\Tools`,
        binDir,
        tempDir,
      }),
    ).toBe(`${binDir};C:\\Tools`);
  });

  it('collapses duplicate entries case-insensitively', () => {
    expect(
      planWindowsUserPath({
        currentPath: `${binDir};C:\\Tools;c:\\users\\tester\\.BARI\\BIN`,
        binDir,
        tempDir,
      }),
    ).toBe(`${binDir};C:\\Tools`);
  });

  it('ignores empty entries and surrounding whitespace', () => {
    expect(planWindowsUserPath({ currentPath: ` ;C:\\Tools; `, binDir, tempDir })).toBe(
      `${binDir};C:\\Tools`,
    );
  });
});
