import { describe, expect, it } from 'vitest';
import { IntentClassifier } from './intent-classifier.js';
import { StateMachine } from './state-machine.js';

describe('StateMachine approval flow', () => {
  it('moves to IMPLEMENTING on explicit approve regardless of plan confidence', () => {
    const stateMachine = new StateMachine('AWAITING_PLAN_CONFIRMATION');
    stateMachine.setPlanConfidence(0.05);

    const result = stateMachine.processApproval('approve');

    expect(result).toEqual({
      approved: true,
      newState: 'IMPLEMENTING',
    });
    expect(stateMachine.getState()).toBe('IMPLEMENTING');
  });

  it('accepts high-confidence Turkish natural-language approval', () => {
    const stateMachine = new StateMachine('AWAITING_PLAN_CONFIRMATION');

    const result = stateMachine.processNaturalLanguageApproval('onayla, basla');

    expect(result.action).toBe('direct_apply');
    expect(result.approved).toBe(true);
    expect(result.newState).toBe('IMPLEMENTING');
    expect(stateMachine.getState()).toBe('IMPLEMENTING');
  });
});

describe('IntentClassifier conflict handling', () => {
  it('prefers revise over approve when both signals are present', () => {
    const classifier = new IntentClassifier({
      conflictPolicy: 'deny_over_approve',
    });

    const result = classifier.classify('approve, but revise milestone 2');

    expect(result.intent).toBe('revise');
    expect(result.confidence).toBeGreaterThan(0);
  });
});
