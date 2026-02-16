export * from './plan-agent.js';
export * from './builder-agent.js';
export * from './qa-agent.js';
export * from './review-agent.js';
export * from './refactor-agent.js';

// Re-export with unified interface
import { getPlanAgentPrompt, getClarificationPrompt, getMilestoneSummaryPrompt } from './plan-agent.js';
import { getBuilderAgentPrompt, getDiffProposalPrompt, getCommandApprovalPrompt } from './builder-agent.js';
import { getQAAgentPrompt, getTestFailureReportPrompt } from './qa-agent.js';
import { getReviewAgentPrompt, getReviewSummaryPrompt } from './review-agent.js';
import { getRefactorAgentPrompt } from './refactor-agent.js';
import type { ApprovalMode } from '@matrix/core';

export interface AgentPromptOptions {
  projectName?: string;
  workingDirectory?: string;
  approvalMode?: ApprovalMode;
  reflexionRetries?: number;
}

/**
 * Get system prompt for a specific agent type
 */
export function getAgentPrompt(
  agentType: 'plan' | 'builder' | 'qa' | 'review' | 'refactor',
  options: AgentPromptOptions = {}
): string {
  const sharedOptions = {
    ...(options.projectName !== undefined ? { projectName: options.projectName } : {}),
    ...(options.workingDirectory !== undefined ? { workingDirectory: options.workingDirectory } : {}),
  };

  switch (agentType) {
    case 'plan':
      return getPlanAgentPrompt({
        ...sharedOptions,
        approvalMode: options.approvalMode ?? 'balanced',
      });
    case 'builder':
      return getBuilderAgentPrompt(sharedOptions);
    case 'qa':
      return getQAAgentPrompt({
        ...sharedOptions,
        reflexionRetries: options.reflexionRetries ?? 3,
      });
    case 'review':
      return getReviewAgentPrompt(sharedOptions);
    case 'refactor':
      return getRefactorAgentPrompt(sharedOptions);
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

/**
 * All prompt generators
 */
export const prompts = {
  plan: {
    system: getPlanAgentPrompt,
    clarification: getClarificationPrompt,
    milestoneSummary: getMilestoneSummaryPrompt,
  },
  builder: {
    system: getBuilderAgentPrompt,
    diffProposal: getDiffProposalPrompt,
    commandApproval: getCommandApprovalPrompt,
  },
  qa: {
    system: getQAAgentPrompt,
    testFailureReport: getTestFailureReportPrompt,
  },
  review: {
    system: getReviewAgentPrompt,
    reviewSummary: getReviewSummaryPrompt,
  },
  refactor: {
    system: getRefactorAgentPrompt,
  },
};
