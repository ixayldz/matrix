import { describe, expect, it } from 'vitest';
import { createEventEmitter } from './emitter.js';

describe('EventEmitter redaction behavior', () => {
  it('keeps non-sensitive payloads unredacted', async () => {
    const emitter = createEventEmitter({
      runId: 'run-test',
      initialState: 'PRD_INTAKE',
      defaultActor: 'system',
    });

    const event = await emitter.emit('user.input', {
      input: 'hello world',
      type: 'text',
    });

    expect(event.redactionLevel).toBe('none');
    expect(event.payload.input).toBe('hello world');
  });

  it('auto-escalates to strict redaction when sensitive payload is detected', async () => {
    const emitter = createEventEmitter({
      runId: 'run-test',
      initialState: 'PRD_INTAKE',
      defaultActor: 'system',
    });

    const event = await emitter.emit('tool.call', {
      toolName: 'http_fetch',
      arguments: {
        apiKey: 'sk-123456789012345678901234567890',
      },
      requiresApproval: true,
    });

    expect(event.redactionLevel).toBe('strict');
    expect((event.payload.arguments as Record<string, string>).apiKey).toBe('[REDACTED]');
  });

  it('overrides weaker redaction with strict when payload is sensitive', async () => {
    const emitter = createEventEmitter({
      runId: 'run-test',
      initialState: 'PRD_INTAKE',
      defaultActor: 'system',
    });

    const event = await emitter.emit(
      'tool.result',
      {
        toolName: 'http_fetch',
        success: true,
        result: { token: 'bearer abcdefghijklmnopqrstuvwxyz' },
        durationMs: 20,
      },
      {
        redactionLevel: 'partial',
      }
    );

    expect(event.redactionLevel).toBe('strict');
    expect((event.payload.result as Record<string, string>).token).toBe('[REDACTED]');
  });
});
