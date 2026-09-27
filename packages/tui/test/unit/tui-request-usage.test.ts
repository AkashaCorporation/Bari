import { describe, expect, it } from 'vitest';
import type { SessionRequestAccounting } from '@bari/shared/request-usage';
import { sumRequestUsageBuckets } from '@bari/shared/request-usage';
import { TuiStatusLine } from '../../src/tui/shell/chrome.js';
import { UsageVisualization } from '../../src/tui/transcript/usage-visualization.js';
import { stripAnsi, visibleWidth } from '../../src/tui/rendering/text.js';

function accounting(): SessionRequestAccounting {
  const own = {
    requests: 12,
    unknownRequests: 0,
    pendingRequests: 0,
    inputTokens: 6100,
    outputTokens: 2000,
    totalTokens: 8100,
  };
  const agents = {
    requests: 6,
    unknownRequests: 0,
    pendingRequests: 0,
    inputTokens: 3000,
    outputTokens: 1200,
    totalTokens: 4200,
  };
  const maintenance = {
    requests: 1,
    unknownRequests: 0,
    pendingRequests: 0,
    inputTokens: 1500,
    outputTokens: 1000,
    totalTokens: 2500,
  };
  return {
    coverage: 'recorded',
    sinceMs: Date.UTC(2026, 8, 27),
    sessionId: 'root',
    own,
    agents,
    maintenance,
    total: sumRequestUsageBuckets([own, agents, maintenance]),
    legacyUnverified: false,
    accountingDegraded: false,
    byAgent: [{ sessionId: 'june', agentName: 'June', category: 'agent', usage: agents }],
  };
}
function renderPanel(value: SessionRequestAccounting, width: number) {
  return new UsageVisualization({
    kind: 'usage',
    model: 'fixture/model',
    accounting: value,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    context: null,
  }).render(width);
}
function rail(value: SessionRequestAccounting, width: number, buildMode = false) {
  return new TuiStatusLine({
    version: 'test',
    workspace: '/synthetic',
    runtimeStatus: 'ready',
    requestAccounting: value,
    statusLineItems: buildMode ? ['token-usage', 'build-mode'] : ['token-usage'],
    agentStatus: 'ready',
  }).render(width);
}

describe('reported request usage presentation', () => {
  it('shows primary, delegated and learning totals in the rail and detailed panel', () => {
    const value = accounting();
    const text = stripAnsi(rail(value, 160).join('\n'));
    expect(text).toContain('Tokens 14.8k');
    expect(text).toContain('own 8.1k');
    expect(text).toContain('agents 4.2k');
    expect(text).toContain('learning 2.5k');
    const panel = stripAnsi(renderPanel(value, 80).join('\n'));
    for (const item of [
      'Own',
      'Agents',
      'Learning',
      'June',
      '14.8k reported',
      'Includes retries and compaction',
    ])
      expect(panel).toContain(item);
  });
  it.each([0, 1, 8, 20, 26, 40, 80, 120])('keeps both displays within %i columns', (width) => {
    for (const line of [...rail(accounting(), width), ...renderPanel(accounting(), width)])
      expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(1, width));
  });
  it('keeps missing, pending, legacy and degraded accounting visible', () => {
    const value = accounting();
    value.total = { requests: 2, unknownRequests: 2, pendingRequests: 1 };
    value.legacyUnverified = true;
    value.accountingDegraded = true;
    expect(stripAnsi(rail(value, 120).join('\n'))).toContain('Tokens ?*');
    const text = stripAnsi(renderPanel(value, 120).join('\n'));
    expect(text).toContain('? reported');
    expect(text).toContain('2 request(s) have incomplete');
    expect(text).toContain('Earlier anonymous usage is not added');
    expect(text).toContain('could not be recorded');
    expect(text).not.toContain('0 reported');
  });
  it('preserves build-mode exclusivity and sanitizes agent names', () => {
    expect(stripAnsi(rail(accounting(), 160, true).join('\n'))).not.toContain('Tokens');
    const value = accounting();
    value.byAgent[0]!.agentName = '\u001b[2JJune\nforged row';
    const lines = renderPanel(value, 80);
    expect(lines.some((line) => line.includes('\u001b[2J'))).toBe(false);
    expect(lines.every((line) => !line.includes('\n'))).toBe(true);
  });
});
