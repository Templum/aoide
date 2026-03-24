import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TelemetryTracker } from '../../../src/telemetry/tracker.js';
import { Suite, Test } from '../../../src/core/ast.js';
import { executionContext } from '../../../src/core/context.js';
import * as configModule from '../../../src/utils/config.js';

vi.mock('../../../src/utils/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/config.js')>();
  return { ...actual, loadConfig: vi.fn().mockResolvedValue({}) };
});

const dummySuite = new Suite('test-suite');

function makeDummyTest(name: string): Test {
  return new Test(name, async () => {}, dummySuite);
}

beforeEach(() => {
  TelemetryTracker.reset();
  TelemetryTracker.resetCache();
});

describe('TelemetryTracker', () => {
  it('calculates app cost correctly for a known OpenAI model and updates globalTelemetry', async () => {
    // gpt-4o: input=$2.50/M, output=$10.00/M
    // 1000 prompt tokens => 1000 * (2.50 / 1_000_000) = $0.0025
    // 500 completion tokens => 500 * (10.00 / 1_000_000) = $0.005
    // total cost = $0.0075
    const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
    const target = { provider: 'openai', model: 'gpt-4o' };

    await TelemetryTracker.record(target, usage, 'app');

    const summary = TelemetryTracker.getSummary();
    expect(summary.appTokens).toBe(1500);
    expect(summary.evalTokens).toBe(0);
    expect(summary.appCost).toBeCloseTo(0.0075, 8);
    expect(summary.evalCost).toBe(0);
  });

  it('calculates eval cost correctly for gpt-4o-mini', async () => {
    // gpt-4o-mini: input=$0.15/M, output=$0.60/M
    // 2000 prompt tokens => 2000 * (0.15 / 1_000_000) = $0.0003
    // 1000 completion tokens => 1000 * (0.60 / 1_000_000) = $0.0006
    // total cost = $0.0009
    const usage = { promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 };
    const target = { provider: 'openai', model: 'gpt-4o-mini' };

    await TelemetryTracker.record(target, usage, 'eval');

    const summary = TelemetryTracker.getSummary();
    expect(summary.evalTokens).toBe(3000);
    expect(summary.appTokens).toBe(0);
    expect(summary.evalCost).toBeCloseTo(0.0009, 8);
    expect(summary.appCost).toBe(0);
  });

  it('local provider is always free (built-in rule, no config required)', async () => {
    const usage = { promptTokens: 500, completionTokens: 200, totalTokens: 700 };

    // Any local model — even one that would be in pricing.json if it existed there
    await TelemetryTracker.record({ provider: 'local', model: 'llama-3' }, usage, 'app');

    const summary = TelemetryTracker.getSummary();
    expect(summary.appTokens).toBe(700);
    expect(summary.appCost).toBe(0);
  });

  it('defaults cost to 0 for an unknown non-local model', async () => {
    const usage = { promptTokens: 500, completionTokens: 200, totalTokens: 700 };

    await TelemetryTracker.record({ provider: 'anthropic', model: 'unknown-model-xyz' }, usage, 'app');

    const summary = TelemetryTracker.getSummary();
    expect(summary.appTokens).toBe(700);
    expect(summary.appCost).toBe(0);
  });

  it('accumulates costs across multiple record calls', async () => {
    const target = { provider: 'openai', model: 'gpt-4o' };
    const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };

    await TelemetryTracker.record(target, usage, 'app');
    await TelemetryTracker.record(target, usage, 'app');

    const summary = TelemetryTracker.getSummary();
    expect(summary.appTokens).toBe(3000);
    expect(summary.appCost).toBeCloseTo(0.015, 8);
  });

  it('updates test.telemetry when record is called inside an executionContext', async () => {
    const test = makeDummyTest('my-test');
    const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
    const target = { provider: 'openai', model: 'gpt-4o' };

    await executionContext.run(test, async () => {
      await TelemetryTracker.record(target, usage, 'app');
    });

    expect(test.telemetry.appTokens).toBe(1500);
    expect(test.telemetry.appCost).toBeCloseTo(0.0075, 8);
    expect(test.telemetry.evalTokens).toBe(0);
    expect(test.telemetry.evalCost).toBe(0);
  });

  it('updates test.telemetry for eval type inside an executionContext', async () => {
    const test = makeDummyTest('eval-test');
    const usage = { promptTokens: 800, completionTokens: 200, totalTokens: 1000 };
    const target = { provider: 'openai', model: 'gpt-4o-mini' };

    await executionContext.run(test, async () => {
      await TelemetryTracker.record(target, usage, 'eval');
    });

    // gpt-4o-mini: input=0.15/M, output=0.60/M
    // 800 * (0.15/1M) + 200 * (0.60/1M) = 0.00012 + 0.00012 = 0.00024
    expect(test.telemetry.evalTokens).toBe(1000);
    expect(test.telemetry.evalCost).toBeCloseTo(0.00024, 8);
    expect(test.telemetry.appTokens).toBe(0);
  });

  it('does not throw and does not write to test.telemetry when called outside a test context', async () => {
    const usage = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };
    const target = { provider: 'openai', model: 'gpt-4o' };

    // No executionContext.run wrapper — getCurrentTest() will throw, tracker must swallow it
    await expect(TelemetryTracker.record(target, usage, 'app')).resolves.toBeUndefined();

    const summary = TelemetryTracker.getSummary();
    expect(summary.appTokens).toBe(150);
  });

  it('pricingOverrides wildcard (e.g. "mycloud:*") overrides pricing.json for all models of that provider', async () => {
    vi.mocked(configModule.loadConfig).mockResolvedValueOnce({
      pricingOverrides: {
        'mycloud:*': { input: 2.00, output: 8.00 },
      },
    });

    // mycloud:*: input=$2.00/M, output=$8.00/M
    // 1000 * (2/1M) + 500 * (8/1M) = 0.002 + 0.004 = 0.006
    const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
    await TelemetryTracker.record({ provider: 'mycloud', model: 'any-model' }, usage, 'app');

    const summary = TelemetryTracker.getSummary();
    expect(summary.appCost).toBeCloseTo(0.006, 8);
  });

  it('pricingOverrides exact key takes precedence over wildcard', async () => {
    vi.mocked(configModule.loadConfig).mockResolvedValueOnce({
      pricingOverrides: {
        'mycloud:*': { input: 2.00, output: 8.00 },
        'mycloud:premium': { input: 10.00, output: 30.00 },
      },
    });

    // exact match: input=$10/M, output=$30/M
    // 1000 * (10/1M) + 500 * (30/1M) = 0.010 + 0.015 = 0.025
    const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
    await TelemetryTracker.record({ provider: 'mycloud', model: 'premium' }, usage, 'app');

    const summary = TelemetryTracker.getSummary();
    expect(summary.appCost).toBeCloseTo(0.025, 8);
  });

  it('getSummary returns a clone, not a live reference', async () => {
    const summary1 = TelemetryTracker.getSummary();
    const target = { provider: 'openai', model: 'gpt-4o' };
    const usage = { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 };
    await TelemetryTracker.record(target, usage, 'app');

    // summary1 should not have changed
    expect(summary1.appTokens).toBe(0);
  });
});
