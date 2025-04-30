import { AIAgent } from '../core/agent';
import { AgentRole, ActionOutcome, AgentPlugin } from './types';
import { neuralNetVotingModel } from '../engine/engine';

// Plugin to log voting decisions
const loggingPlugin: AgentPlugin = {
  onDecision: async (agent: AIAgent, decision: boolean | string) => {
    console.log(`Agent ${agent.id} (voter) made decision: ${decision}`);
  },
};

export function createVoterAgent(id: number, priority: number = 0, useNN: boolean = false): AIAgent {
  const decisionModel = async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<boolean> => {
    // Fetch MCP data for historical votes
    await agent.fetchMCPContext(env.chain, 'votes', { range: { start: env.blockHeight - 10, end: env.blockHeight } });

    // Calculate peer influence
    const peerVotes = agents
      .filter(a => a.id !== agent.id && (a.role === AgentRole.Voter || a.role === AgentRole.Governor))
      .map(a => a.getHistoricalActions('vote'))
      .flat();
    const peerApproveRatio = peerVotes.length > 0 ? peerVotes.filter(v => v === true).length / peerVotes.length : 0.5;

    // Use MCP data for context
    const mcpVotes = agent.mcpContext['votes']?.data || [];
    const mcpApproveRatio = mcpVotes.length > 0 ? mcpVotes.filter(v => v === true).length / mcpVotes.length : 0.5;

    // Consider agent's own historical voting pattern
    const ownVotes = agent.getHistoricalActions('vote');
    const ownApproveRatio = ownVotes.length > 0 ? ownVotes.filter(v => v === true).length / ownVotes.length : 0.5;

    // Weighted decision model
    const weights = { peer: 0.4, mcp: 0.4, self: 0.2 };
    const weightedScore =
      weights.peer * peerApproveRatio +
      weights.mcp * mcpApproveRatio +
      weights.self * ownApproveRatio;

    if (useNN && agent.nnModel) {
      return neuralNetVotingModel(agent, env, agent.nnModel, agents);
    }

    return weightedScore > 0.5;
  };

  return new AIAgent(id, AgentRole.Voter, decisionModel, {
    useNN,
    priority,
    plugins: [loggingPlugin],
  });
}
