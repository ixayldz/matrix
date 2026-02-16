import type { ApprovalDecision } from './types.js';

/**
 * Intent classification result
 */
export interface IntentResult {
  intent: ApprovalDecision;
  confidence: number;
  reasoning?: string;
  conflictingIntents?: Array<{ intent: ApprovalDecision; confidence: number }>;
}

/**
 * Intent classification options
 */
export interface IntentClassifierOptions {
  approveThreshold: number;
  confirmThreshold: number;
  conflictPolicy: 'deny_over_approve' | 'approve_over_deny' | 'strict';
}

/**
 * Keywords and patterns for each intent type
 */
const INTENT_PATTERNS: Record<ApprovalDecision, {
  positive: RegExp[];
  negative: RegExp[];
  weight: number;
}> = {
  approve: {
    positive: [
      /\b(approve|approved|approving)\b/i,
      /\b(yes|yeah|yep|yup|sure|ok|okay)\b/i,
      /\b(go ahead|proceed|continue|do it|apply)\b/i,
      /\b(confirm|confirmed|confirming)\b/i,
      /\b(accept|accepted|accepting)\b/i,
      /\b(looks good|looks great|looks fine|looks correct)\b/i,
      /\b(lgtm|ship it|merge it)\b/i,
      /\b(start implementation|begin implementation)\b/i,
      /\b(execute|run it|let's do this)\b/i,
      /\b(onayla|onaylıyorum)\b/i,
      /\b(başla|devam)\b/i,
      /\b(evet|tamam|olur)\b/i,
      /\b(go|start)\b/i,
    ],
    negative: [
      /\b(don'?t|do not)\b.*\b(approve|apply|execute)\b/i,
    ],
    weight: 1.0,
  },
  revise: {
    positive: [
      /\b(revise|revised|revising)\b/i,
      /\b(change|changed|changing|changes)\b/i,
      /\b(modify|modified|modifying)\b/i,
      /\b(update|updated|updating)\b/i,
      /\b(edit|edited|editing)\b/i,
      /\b(fix|fixed|fixing)\b/i,
      /\b(adjust|adjusted|adjusting)\b/i,
      /\b(improve|improved|improving)\b/i,
      /\b(rewrite|rewrote|rewriting)\b/i,
      /\b(try again|redo)\b/i,
      /\b(but|however|except)\b/i,
      /\b(not quite|not exactly|almost)\b/i,
      /\b(need to|should|could|would be better)\b/i,
      /\b(revize|değiştir|güncelle|düzelt)\b/i,
      /\b(kapsamı daralt|milestone)\b/i,
    ],
    negative: [],
    weight: 0.9,
  },
  ask: {
    positive: [
      /\b(what|why|how|when|where|who|which)\b/i,
      /\b(can you explain|could you explain|please explain)\b/i,
      /\b(clarify|clarification|clarifying)\b/i,
      /\b(question|questions|wondering)\b/i,
      /\b(confused|confusing|don'?t understand)\b/i,
      /\b(tell me more|more info|more information)\b/i,
      /\b(what about|how about|what if)\b/i,
      /\b(neden|nasıl|ne|niye|hangi)\b/i,
      /\b(açıklar mısın|alternatif ne|risk ne)\b/i,
      /\?\s*$/,
    ],
    negative: [],
    weight: 0.8,
  },
  deny: {
    positive: [
      /\b(deny|denied|denying)\b/i,
      /\b(no|nope|nah|nay)\b/i,
      /\b(reject|rejected|rejecting)\b/i,
      /\b(cancel|cancelled|cancelling)\b/i,
      /\b(stop|stopped|stopping)\b/i,
      /\b(abort|aborted|aborting)\b/i,
      /\b(don'?t|do not)\b.*\b(do|apply|execute|run)\b/i,
      /\b(not approved|not accepted|not confirmed)\b/i,
      /\b(wrong|incorrect|bad|terrible)\b/i,
      /\b(never|absolutely not|definitely not)\b/i,
      /\b(too risky|dangerous|unsafe)\b/i,
      /\b(hayır|iptal|dur)\b/i,
      /\b(başlamayalım|şimdilik hayır)\b/i,
    ],
    negative: [],
    weight: 1.1, // Higher weight for deny to prioritize safety
  },
};

/**
 * Intent Classifier for natural language approval flow
 * PRD Section 4.2
 */
export class IntentClassifier {
  private options: IntentClassifierOptions;

  constructor(options: Partial<IntentClassifierOptions> = {}) {
    this.options = {
      approveThreshold: options.approveThreshold ?? 0.85,
      confirmThreshold: options.confirmThreshold ?? 0.60,
      conflictPolicy: options.conflictPolicy ?? 'deny_over_approve',
    };
  }

  /**
   * Classify user input to determine approval intent
   */
  classify(input: string): IntentResult {
    const normalizedInput = input.trim().toLowerCase();

    // Calculate scores for each intent
    const scores: Map<ApprovalDecision, { score: number; matches: string[] }> = new Map();

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      let score = 0;
      const matches: string[] = [];

      // Check positive patterns
      for (const pattern of patterns.positive) {
        const match = normalizedInput.match(pattern);
        if (match) {
          score += patterns.weight;
          matches.push(match[0]);
        }
      }

      // Check negative patterns
      for (const pattern of patterns.negative) {
        if (pattern.test(normalizedInput)) {
          score -= patterns.weight * 2; // Negative matches reduce score significantly
        }
      }

      scores.set(intent as ApprovalDecision, { score, matches });
    }

    // Normalize scores to confidence values
    const totalScore = Array.from(scores.values()).reduce((sum, s) => sum + Math.max(0, s.score), 0);

    const results: Array<{ intent: ApprovalDecision; confidence: number; matches: string[] }> = [];

    for (const [intent, { score, matches }] of scores) {
      const confidence = totalScore > 0 ? Math.min(1, score / totalScore) : 0;
      results.push({ intent, confidence, matches });
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    // Get top result
    const top = results[0];
    if (!top || top.confidence === 0) {
      // No clear intent detected, default to 'ask'
      return {
        intent: 'ask',
        confidence: 0,
        reasoning: 'No clear intent detected in user input',
      };
    }

    // Check for conflicting intents
    const conflictingIntents = results
      .filter(r => r.intent !== top.intent && r.confidence > 0.3)
      .map(r => ({ intent: r.intent, confidence: r.confidence }));

    // Resolve conflicts using policy
    let finalIntent = top.intent;
    let finalConfidence = top.confidence;

    if (conflictingIntents.length > 0) {
      finalIntent = this.resolveConflict(top.intent, conflictingIntents);
      if (finalIntent !== top.intent) {
        finalConfidence = conflictingIntents.find(c => c.intent === finalIntent)?.confidence ?? top.confidence;
      }
    }

    // Apply confidence thresholds
    const action = this.getThresholdAction(finalConfidence);

    const result: IntentResult = {
      intent: finalIntent,
      confidence: finalConfidence,
      reasoning: this.generateReasoning(finalIntent, finalConfidence, results, action),
    };
    if (conflictingIntents.length > 0) {
      result.conflictingIntents = conflictingIntents;
    }
    return result;
  }

  /**
   * Get action based on confidence threshold
   */
  private getThresholdAction(confidence: number): 'direct_apply' | 'confirm' | 'no_change' {
    if (confidence >= this.options.approveThreshold) {
      return 'direct_apply';
    }
    if (confidence >= this.options.confirmThreshold) {
      return 'confirm';
    }
    return 'no_change';
  }

  /**
   * Resolve conflicting intents based on policy
   * Priority: deny > revise > approve (deny_over_approve)
   */
  private resolveConflict(
    topIntent: ApprovalDecision,
    conflicts: Array<{ intent: ApprovalDecision; confidence: number }>
  ): ApprovalDecision {
    const conflictIntents = conflicts.map(c => c.intent);

    switch (this.options.conflictPolicy) {
      case 'deny_over_approve':
        // Priority: deny > revise > approve > ask
        if (conflictIntents.includes('deny') || topIntent === 'deny') return 'deny';
        if (conflictIntents.includes('revise') || topIntent === 'revise') return 'revise';
        if (topIntent === 'approve' && conflictIntents.some(c => ['deny', 'revise'].includes(c))) {
          // If approve conflicts with deny/revise, prefer the conflict
          const conflict = conflicts.find(c => ['deny', 'revise'].includes(c.intent));
          if (conflict) return conflict.intent;
        }
        return topIntent;

      case 'approve_over_deny':
        // Priority: approve > revise > deny > ask
        if (topIntent === 'approve') return 'approve';
        if (conflictIntents.includes('approve')) return 'approve';
        if (conflictIntents.includes('revise') || topIntent === 'revise') return 'revise';
        return topIntent;

      case 'strict':
        // If any conflict, require explicit confirmation
        if (conflicts.length > 0) return 'ask';
        return topIntent;

      default:
        return topIntent;
    }
  }

  /**
   * Generate human-readable reasoning
   */
  private generateReasoning(
    intent: ApprovalDecision,
    confidence: number,
    results: Array<{ intent: ApprovalDecision; confidence: number; matches: string[] }>,
    action: 'direct_apply' | 'confirm' | 'no_change'
  ): string {
    const intentLabels: Record<ApprovalDecision, string> = {
      approve: 'Approved',
      revise: 'Revision requested',
      ask: 'Question/clarification needed',
      deny: 'Denied',
    };

    const actionLabels: Record<string, string> = {
      direct_apply: 'will be applied directly',
      confirm: 'requires explicit confirmation',
      no_change: 'state unchanged, awaiting more input',
    };

    const topMatches = results.find(r => r.intent === intent)?.matches ?? [];

    let reasoning = `Intent: ${intentLabels[intent]} (confidence: ${(confidence * 100).toFixed(0)}%)`;

    if (topMatches.length > 0) {
      reasoning += ` - matched keywords: ${topMatches.join(', ')}`;
    }

    reasoning += ` → ${actionLabels[action]}`;

    return reasoning;
  }

  /**
   * Quick check if input is likely an approval
   */
  isLikelyApproval(input: string): boolean {
    const result = this.classify(input);
    return result.intent === 'approve' && result.confidence >= this.options.confirmThreshold;
  }

  /**
   * Quick check if input is likely a denial
   */
  isLikelyDenial(input: string): boolean {
    const result = this.classify(input);
    return result.intent === 'deny' && result.confidence >= this.options.confirmThreshold;
  }

  /**
   * Get classifier options
   */
  getOptions(): IntentClassifierOptions {
    return { ...this.options };
  }

  /**
   * Update classifier options
   */
  setOptions(options: Partial<IntentClassifierOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

/**
 * Create an intent classifier
 */
export function createIntentClassifier(
  options: Partial<IntentClassifierOptions> = {}
): IntentClassifier {
  return new IntentClassifier(options);
}
