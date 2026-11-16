import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  prepareValidationRequest,
  publishValidatedJob,
} from '../packages/local-runtime/assets/skills/hexcore-jobs/scripts/validated-job.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function fixture() {
  const workspace = await mkdtemp(join(tmpdir(), 'bari-hexcore-job-'));
  temporaryDirectories.push(workspace);
  const target = join(workspace, 'target.exe');
  const draft = join(workspace, 'audit.hexcore_job.draft.json');
  const output = join(workspace, 'audit.hexcore_job.json');
  const validation = join(workspace, 'audit.validation.json');
  const request = join(workspace, 'audit.validation-request.json');
  await writeFile(target, 'synthetic-target');
  await writeFile(
    draft,
    `${JSON.stringify(
      {
        file: target,
        outDir: './reports/audit',
        steps: [
          {
            cmd: 'hexcore.hash.calculate',
            output: { path: 'hash.json', format: 'json' },
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return { workspace, target, draft, output, validation, request };
}

async function canonicalValidation(paths, overrides = {}) {
  const prepared = await prepareValidationRequest({
    workspace: paths.workspace,
    draft: paths.draft,
    output: paths.output,
    validation: paths.validation,
    request: paths.request,
  });
  const report = {
    jobFile: paths.draft,
    file: paths.target,
    outDir: join(paths.workspace, 'reports', 'audit'),
    quiet: true,
    ok: true,
    generatedAt: new Date(Date.parse(prepared.request.createdAt) + 1_000).toISOString(),
    totalSteps: 1,
    issues: [],
    steps: [],
    ...overrides,
  };
  await writeFile(paths.validation, `${JSON.stringify(report, null, 2)}\n`);
  return prepared;
}

describe('validated HexCore job publication', () => {
  it('publishes the exact validated draft atomically and records a receipt', async () => {
    const paths = await fixture();
    await canonicalValidation(paths);
    const result = await publishValidatedJob({
      workspace: paths.workspace,
      draft: paths.draft,
      output: paths.output,
      validation: paths.validation,
      request: paths.request,
    });
    expect(await readFile(paths.output)).toEqual(await readFile(paths.draft));
    expect(result.receipt.output).toBe(paths.output);
    expect(result.receipt.jobSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.receipt.validationSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('resolves relative workflow paths from the declared workspace', async () => {
    const paths = await fixture();
    await canonicalValidation(paths);
    const result = await publishValidatedJob({
      workspace: paths.workspace,
      draft: 'audit.hexcore_job.draft.json',
      output: 'audit.hexcore_job.json',
      validation: 'audit.validation.json',
      request: 'audit.validation-request.json',
    });
    expect(await readFile(paths.output)).toEqual(await readFile(paths.draft));
    expect(result.receipt.output).toBe(paths.output);
  });

  it('refuses a draft name that would trigger the watcher before validation', async () => {
    const paths = await fixture();
    const watched = join(paths.workspace, 'unsafe.hexcore_job.json');
    await writeFile(watched, await readFile(paths.draft));
    await expect(
      prepareValidationRequest({ ...paths, draft: watched }),
    ).rejects.toThrow('matches the HexCore watcher');
  });

  it('refuses changed bytes and a failed canonical validation report', async () => {
    const paths = await fixture();
    await canonicalValidation(paths);
    await writeFile(paths.draft, `${await readFile(paths.draft, 'utf8')} `);
    await expect(
      publishValidatedJob({
        workspace: paths.workspace,
        draft: paths.draft,
        output: paths.output,
        validation: paths.validation,
        request: paths.request,
      }),
    ).rejects.toThrow('Draft changed');

    const second = await fixture();
    await canonicalValidation(second, {
      ok: false,
      issues: [{ level: 'error', code: 'INVALID', message: 'bad job' }],
    });
    await expect(
      publishValidatedJob({
        workspace: second.workspace,
        draft: second.draft,
        output: second.output,
        validation: second.validation,
        request: second.request,
      }),
    ).rejects.toThrow('did not approve');
  });

  it('refuses unsafe step outputs and replacement of an existing watched job', async () => {
    const paths = await fixture();
    const job = JSON.parse(await readFile(paths.draft, 'utf8'));
    job.steps[0].output.path = join(tmpdir(), 'escaped.json');
    await writeFile(paths.draft, `${JSON.stringify(job)}\n`);
    await expect(prepareValidationRequest(paths)).rejects.toThrow(
      'output.path must be a relative path',
    );

    const second = await fixture();
    await canonicalValidation(second);
    await writeFile(second.output, 'existing job');
    await expect(
      publishValidatedJob({
        workspace: second.workspace,
        draft: second.draft,
        output: second.output,
        validation: second.validation,
        request: second.request,
      }),
    ).rejects.toThrow('already exists');
  });
});
