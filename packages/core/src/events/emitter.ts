import type { EventEnvelope, EventType, EventTypeMap } from './types.js';
import { createEnvelope, redactPayload } from './envelope.js';
import type { WorkflowState, AgentType, RedactionLevel } from '../types.js';

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/,
  /sk-ant-[a-zA-Z0-9-]{20,}/,
  /api[_-]?key\b/i,
  /secret\b/i,
  /token\b/i,
  /bearer\s+[a-zA-Z0-9._-]+/i,
  /password\b/i,
];

const SENSITIVE_KEYS = ['secret', 'key', 'token', 'password', 'credential', 'authorization'];

function hasSensitiveData(payload: unknown): boolean {
  if (payload === null || payload === undefined) {
    return false;
  }

  if (typeof payload === 'string') {
    return SECRET_PATTERNS.some((pattern) => pattern.test(payload));
  }

  if (Array.isArray(payload)) {
    return payload.some((item) => hasSensitiveData(item));
  }

  if (typeof payload === 'object') {
    return Object.entries(payload).some(([key, value]) => {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.some((sensitiveKey) => lowerKey.includes(sensitiveKey))) {
        return true;
      }
      return hasSensitiveData(value);
    });
  }

  return false;
}

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => void | Promise<void>;

/**
 * Event emitter configuration
 */
export interface EventEmitterConfig {
  runId: string;
  initialState: WorkflowState;
  defaultActor: AgentType;
  persistEvents?: boolean;
  maxListeners?: number;
}

/**
 * Event emitter for Matrix CLI
 */
export class EventEmitter {
  private runId: string;
  private currentState: WorkflowState;
  private defaultActor: AgentType;
  private handlers: Map<string, Set<EventHandler>>;
  private wildCardHandlers: Set<EventHandler>;
  private eventLog: EventEnvelope[];
  private maxListeners: number;

  constructor(config: EventEmitterConfig) {
    this.runId = config.runId;
    this.currentState = config.initialState;
    this.defaultActor = config.defaultActor;
    this.handlers = new Map();
    this.wildCardHandlers = new Set();
    this.eventLog = [];
    this.maxListeners = config.maxListeners ?? 100;
  }

  /**
   * Update current state (called by state machine)
   */
  setState(state: WorkflowState): void {
    this.currentState = state;
  }

  /**
   * Set default actor
   */
  setDefaultActor(actor: AgentType): void {
    this.defaultActor = actor;
  }

  /**
   * Subscribe to a specific event type
   */
  on<T extends EventType>(eventType: T, handler: EventHandler<EventTypeMap[T]>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const handlers = this.handlers.get(eventType)!;
    if (handlers.size >= this.maxListeners) {
      console.warn(`Max listeners (${this.maxListeners}) reached for event type: ${eventType}`);
    }

    handlers.add(handler as EventHandler);

    // Return unsubscribe function
    return () => {
      handlers.delete(handler as EventHandler);
    };
  }

  /**
   * Subscribe to all events
   */
  onAll(handler: EventHandler): () => void {
    this.wildCardHandlers.add(handler);
    return () => {
      this.wildCardHandlers.delete(handler);
    };
  }

  /**
   * Subscribe to event once
   */
  once<T extends EventType>(eventType: T, handler: EventHandler<EventTypeMap[T]>): () => void {
    const wrappedHandler: EventHandler<EventTypeMap[T]> = (event) => {
      this.off(eventType, wrappedHandler);
      return handler(event);
    };
    return this.on(eventType, wrappedHandler);
  }

  /**
   * Unsubscribe from event
   */
  off<T extends EventType>(eventType: T, handler: EventHandler<EventTypeMap[T]>): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler as EventHandler);
    }
  }

  /**
   * Emit an event
   */
  async emit<T extends EventType>(
    type: T,
    payload: EventTypeMap[T],
    options?: {
      actor?: AgentType;
      correlationId?: string;
      redactionLevel?: RedactionLevel;
    }
  ): Promise<EventEnvelope<EventTypeMap[T]>> {
    const envelopeOptions: { correlationId?: string; redactionLevel?: RedactionLevel } = {};
    if (options?.correlationId !== undefined) {
      envelopeOptions.correlationId = options.correlationId;
    }
    if (options?.redactionLevel !== undefined) {
      envelopeOptions.redactionLevel = options.redactionLevel;
    }

    const autoStrict = hasSensitiveData(payload);
    if (autoStrict) {
      envelopeOptions.redactionLevel = 'strict';
    }

    const resolvedRedactionLevel = envelopeOptions.redactionLevel ?? 'none';
    const sanitizedPayload = (resolvedRedactionLevel === 'none'
      ? payload
      : redactPayload(payload, resolvedRedactionLevel, SECRET_PATTERNS)) as EventTypeMap[T];

    const envelope = createEnvelope(
      this.runId,
      this.currentState,
      options?.actor ?? this.defaultActor,
      type,
      sanitizedPayload,
      envelopeOptions
    );

    // Log event
    this.eventLog.push(envelope);

    // Call specific handlers
    const handlers = this.handlers.get(type);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(envelope);
        } catch (error) {
          console.error(`Error in event handler for ${type}:`, error);
        }
      }
    }

    // Call wildcard handlers
    for (const handler of this.wildCardHandlers) {
      try {
        await handler(envelope);
      } catch (error) {
        console.error('Error in wildcard event handler:', error);
      }
    }

    return envelope;
  }

  /**
   * Get event log
   */
  getEventLog(): EventEnvelope[] {
    return [...this.eventLog];
  }

  /**
   * Get events by type
   */
  getEventsByType<T extends EventType>(type: T): EventEnvelope<EventTypeMap[T]>[] {
    return this.eventLog.filter((e) => e.type === type) as EventEnvelope<EventTypeMap[T]>[];
  }

  /**
   * Get events by actor
   */
  getEventsByActor(actor: AgentType): EventEnvelope[] {
    return this.eventLog.filter((e) => e.actor === actor);
  }

  /**
   * Clear event log
   */
  clearEventLog(): void {
    this.eventLog = [];
  }

  /**
   * Export event log as JSON
   */
  exportEventLog(pretty = false): string {
    return JSON.stringify(this.eventLog, null, pretty ? 2 : 0);
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.eventLog.length;
  }

  /**
   * Get last event
   */
  getLastEvent(): EventEnvelope | undefined {
    return this.eventLog[this.eventLog.length - 1];
  }

  /**
   * Create child emitter with different default actor
   */
  child(defaultActor: AgentType): EventEmitter {
    const childEmitter = new EventEmitter({
      runId: this.runId,
      initialState: this.currentState,
      defaultActor,
      maxListeners: this.maxListeners,
    });

    // Share event log
    childEmitter['eventLog'] = this.eventLog;

    return childEmitter;
  }
}

/**
 * Create a new event emitter
 */
export function createEventEmitter(config: EventEmitterConfig): EventEmitter {
  return new EventEmitter(config);
}
