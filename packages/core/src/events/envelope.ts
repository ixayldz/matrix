import { v4 as uuidv4 } from 'uuid';
import { EVENT_VERSION, type EventEnvelope, type EventType, type EventTypeMap } from './types.js';
import type { WorkflowState, AgentType, RedactionLevel } from '../types.js';

/**
 * Create a new event envelope
 */
export function createEnvelope<T extends EventType>(
  runId: string,
  state: WorkflowState,
  actor: AgentType,
  type: T,
  payload: EventTypeMap[T],
  options?: {
    correlationId?: string;
    redactionLevel?: RedactionLevel;
  }
): EventEnvelope<EventTypeMap[T]> {
  return {
    eventVersion: EVENT_VERSION,
    runId,
    eventId: uuidv4(),
    timestamp: new Date().toISOString(),
    state,
    actor,
    type,
    correlationId: options?.correlationId ?? uuidv4(),
    payload,
    redactionLevel: options?.redactionLevel ?? 'none',
  };
}

/**
 * Validate event envelope structure
 */
export function validateEnvelope(envelope: unknown): envelope is EventEnvelope {
  if (typeof envelope !== 'object' || envelope === null) {
    return false;
  }

  const env = envelope as Record<string, unknown>;

  return (
    env.eventVersion === EVENT_VERSION &&
    typeof env.runId === 'string' &&
    typeof env.eventId === 'string' &&
    typeof env.timestamp === 'string' &&
    typeof env.state === 'string' &&
    typeof env.actor === 'string' &&
    typeof env.type === 'string' &&
    typeof env.correlationId === 'string' &&
    'payload' in env &&
    typeof env.redactionLevel === 'string'
  );
}

/**
 * Redact sensitive data from event payload
 */
export function redactPayload(
  payload: unknown,
  level: RedactionLevel,
  patterns: RegExp[] = []
): unknown {
  if (level === 'none') {
    return payload;
  }

  if (typeof payload === 'string') {
    return redactString(payload, level, patterns);
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => redactPayload(item, level, patterns));
  }

  if (typeof payload === 'object' && payload !== null) {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      const lowerKey = key.toLowerCase();
      const isSensitive =
        lowerKey.includes('secret') ||
        lowerKey.includes('key') ||
        lowerKey.includes('token') ||
        lowerKey.includes('password') ||
        lowerKey.includes('credential');

      if (isSensitive && level === 'strict') {
        redacted[key] = '[REDACTED]';
      } else if (isSensitive && level === 'partial') {
        redacted[key] = typeof value === 'string' ? value.slice(0, 4) + '***' : '[REDACTED]';
      } else {
        redacted[key] = redactPayload(value, level, patterns);
      }
    }
    return redacted;
  }

  return payload;
}

/**
 * Redact sensitive patterns from string
 */
function redactString(text: string, level: RedactionLevel, patterns: RegExp[]): string {
  let result = text;

  for (const pattern of patterns) {
    result = result.replace(pattern, (match) => {
      if (level === 'strict') {
        return '[REDACTED]';
      }
      // Partial: show first 4 chars
      return match.slice(0, 4) + '***';
    });
  }

  return result;
}

/**
 * Serialize envelope to JSON
 */
export function serializeEnvelope(envelope: EventEnvelope, pretty = false): string {
  return JSON.stringify(envelope, null, pretty ? 2 : 0);
}

/**
 * Deserialize envelope from JSON
 */
export function deserializeEnvelope(json: string): EventEnvelope | null {
  try {
    const parsed = JSON.parse(json);
    if (validateEnvelope(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
