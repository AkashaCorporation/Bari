import { describe, expect, it } from 'vitest';
import type { LocalTaskRunnerHostWithSessionLookup } from '../../src/api/local-task-host.js';
import type { LocalBackgroundBashExecutorResult } from '../../src/background-task/bash-executor.js';
import { BackgroundBashOutputWriter } from '../../src/background-task/bash-output-writer.js';
import { settleFailedBackgroundBash, withTaskOutputReceipt } from '../../src/background-task/bash-task-settlement.js';

function fixture() {
  let content = '';
  const host = {
    nowMs: () => 1000,
    backgroundTaskService: {
      appendOutput: async (chunk: { content: string }) => {
        content += chunk.content;
        return { taskId: 'task', kind: 'file', uri: '/synthetic/task-output', offset: Buffer.byteLength(content) };
      },
      patchIfNotTerminal: async (_id: string, patch: object) => ({ patched: true, task: { taskId: 'task', ...patch } }),
    },
  } as unknown as LocalTaskRunnerHostWithSessionLookup;
  return { host, writer: new BackgroundBashOutputWriter(host, 'session', 'task'), content: () => content };
}

describe('background Bash output evidence contract', () => {
  it('retains a complete non-streaming result', async () => {
    const { writer, content } = fixture();
    const result = { text: 'whole output' };
    const ref = await writer.settleSuccess(result);
    const receipt = withTaskOutputReceipt(result, writer, ref, 'task');
    expect(content()).toBe(result.text);
    expect(receipt.details).toMatchObject({ output: { persistence: 'complete', rawBytes: 12, omittedBytes: 0 }, fullOutputPath: '/synthetic/task-output' });
  });

  it.each([
    { truncation: { truncated: true } },
    { output: { persistence: 'incomplete' } },
    { output: { rawBytes: 100, persistence: 'complete' } },
    { processOutput: { stdoutTruncated: true } },
    { processOutput: { stderrTruncated: true } },
    { output: { rawBytes: Number.NaN } },
  ])('never relabels an incomplete executor preview as a full log: %j', async (details) => {
    const { writer, content } = fixture();
    const result = { text: 'preview', details };
    const ref = await writer.settleSuccess(result);
    const receipt = withTaskOutputReceipt(result, writer, ref, 'task');
    expect(content()).toBe('preview');
    expect(receipt.details.output).toMatchObject({ persistence: 'incomplete' });
    expect(receipt.details).not.toHaveProperty('fullOutputPath');
    expect(receipt.text).toContain('saved portion');
    expect(Number.isFinite((receipt.details.output as { rawBytes: number }).rawBytes)).toBe(true);
  });

  it('does not infer raw omitted bytes from a decorated non-streaming preview', async () => {
    const { writer } = fixture();
    const ref = await writer.settleSuccess({ text: 'preview', details: { output: { rawBytes: 100 } } });
    expect(writer.describePersistence(ref)).toEqual({ rawBytes: 100, omittedBytes: 0, omittedBytesIncomplete: true, persistence: 'incomplete' });
  });

  it('does not count a status explanation as raw command output', async () => {
    const { writer } = fixture();
    const ref = await writer.settleSuccess({ text: 'Command exited with code 7', details: { output: { rawBytes: 0 } } });
    expect(writer.describePersistence(ref)).toEqual({ rawBytes: 0, omittedBytes: 0, persistence: 'complete' });
  });

  it('uses a complete host stream even when the executor private output file failed', async () => {
    const { writer, content } = fixture();
    writer.push('complete output', 15);
    const result = { text: 'preview', details: { truncation: { truncated: true }, output: { rawBytes: 15, persistence: 'incomplete' } } };
    const ref = await writer.settleSuccess(result);
    expect(content()).toBe('complete output');
    expect(withTaskOutputReceipt(result, writer, ref, 'task').details.output).toMatchObject({ persistence: 'complete', omittedBytes: 0 });
  });

  it('does not mistake a partial stream for complete raw output', async () => {
    const { writer } = fixture();
    writer.push('part', 4);
    const ref = await writer.settleSuccess({ text: 'preview', details: { output: { rawBytes: 10 } } });
    expect(writer.describePersistence(ref)).toEqual({ rawBytes: 10, omittedBytes: 6, persistence: 'incomplete' });
  });

  it('keeps failed-command preview incompleteness in the final task receipt', async () => {
    const { writer, host, content } = fixture();
    const result: LocalBackgroundBashExecutorResult = { text: 'partial error', isError: true, details: { output: { rawBytes: 100 }, truncation: { truncated: true }, execution: { status: 'failed', reason: 'exited', exitCode: 7 } } };
    const receipt = await settleFailedBackgroundBash({ host, taskId: 'task', controller: new AbortController() }, writer, result, 900, false, 60_000);
    expect(receipt.status).toBe('failed');
    expect(receipt.details?.output).toMatchObject({ persistence: 'incomplete', rawBytes: 100, omittedBytes: 0, omittedBytesIncomplete: true });
    expect(receipt.details).not.toHaveProperty('fullOutputPath');
    expect(content()).toContain('partial error');
    expect(receipt.text).toContain('saved portion');
  });
});
