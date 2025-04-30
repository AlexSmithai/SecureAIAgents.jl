import { AIAgent, NeuralNetModel } from '../core/agent';
import { AgentRole, ActionOutcome, AgentPlugin } from './types';
import { submitVote } from '../web3/blockchain';
import { callTEESecureFunction, generateZKProof } from '../tools/tee';
import { juliaInterface } from '../tools/juliaInterface';
import { logger } from '../tools/logger';

interface GovernancePersonality {
  consensusThreshold: number; // 0 to 1
  adaptability: number; // 0 to 1, for role evolution
}

interface ConsensusState {
  proposalId: string;
  votes: Record<number, boolean>;
  consensusScore: number;
}

const consensusPlugin: AgentPlugin = {
  onStep: async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]) => {
    const governanceAgents = agents.filter(a => a['getId']() !== agent['getId']() && a['getRole']() === AgentRole.Governor);
    const consensusState: ConsensusState = agent['state'].consensusState || { proposalId: env.proposalId, votes: {}, consensusScore: 0 };
    governanceAgents.forEach(peer => {
      const peerVote = peer['getHistoricalActions']('decision').slice(-1)[0];
      if (peerVote !== undefined) {
        consensusState.votes[peer['getId']()] = peerVote === 'vote_approve';
      }
    });
    consensusState.consensusScore = Object.values(consensusState.votes).filter(v => v).length / (governanceAgents.length || 1);
    agent['state'].consensusState = consensusState;
    logger.info(`Agent ${agent['getId']()} (governance) consensus score: ${consensusState.consensusScore}`);
  },
};

const roleEvolutionPlugin: AgentPlugin = {
  onDecision: async (agent: AIAgent, decision: boolean | string) => {
    const personality: GovernancePersonality = agent['personality'] || { consensusThreshold: 0.7, adaptability: 0.5 };
    const consensusState: ConsensusState = agent['state'].consensusState || { proposalId: '', votes: {}, consensusScore: 0 };
    if (personality.adaptability > Math.random() && consensusState.consensusScore < 0.3) {
      agent['role'] = AgentRole.Voter; // Evolve to voter if consensus is low
      logger.info(`Agent ${agent['getId']()} evolved role to Voter due to low consensus`);
    }
  },
};

export function createGovernanceAgent(id: number, priority: number = 0, useNN: boolean = false, personality: GovernancePersonality = { consensusThreshold: 0.7, adaptability: 0.5 }): AIAgent {
  const decisionModel = async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<string> => {
    // Fetch MCP data for proposals
    await agent['fetchMCPContext'](env.chain, 'proposals', { contractAddress: env.contractAddress });

    // Consensus analysis
    const consensusState: ConsensusState = agent['state'].consensusState || { proposalId: env.proposalId, votes: {}, consensusScore: 0 };
    const proposals = agent['mcpContext']['proposals']?.data || [];
    const proposalImpact = proposals.length > 0 ? Math.random() : 0.5; // Simulate impact assessment

    // Game-theoretic decision with Julia
    const decisionWeights = await juliaInterface.executeJLDecision(
      'src/agents/governanceAgent.jl',
      consensusState.consensusScore,
      proposalImpact,
      personality.consensusThreshold
    );
    const parsedWeights = JSON.parse(decisionWeights); // { consensus: number, impact: number, threshold: number }
    const decisionScore = parsedWeights.consensus * consensusState.consensusScore +
                         parsedWeights.impact * proposalImpact +
                         parsedWeights.threshold * personality.consensusThreshold;
    let shouldApprove = decisionScore > 0.5;

    // Deep RL prediction if enabled
    if (useNN && agent['nnModel']) {
      const features = [consensusState.consensusScore, proposalImpact, personality.consensusThreshold, env.blockHeight / 1000, agent['lastReward']];
      const prediction = (agent['nnModel'] as NeuralNetModel).predict(features);
      shouldApprove = prediction[0] > prediction[1];
    }

    if (shouldApprove) {
      const secureVote = agent['secureDecision']('approve');
      const proof = await generateZKProof(secureVote);
      const txHash = await submitVote(env.chain, true);
      const outcome = txHash !== '0x0' ? ActionOutcome.Success : ActionOutcome.Failure;
      agent['recordAction'](env.step || 0, 'vote_approve', outcome, { txHash, proof });

      // Update RL
      agent['lastReward'] = outcome === ActionOutcome.Success ? 1 : -1;
      if (agent['nnModel']) {
        const labels = outcome === ActionOutcome.Success ? [[1, 0]] : [[0, 1]];
        await (agent['nnModel'] as NeuralNetModel).train([features], labels);
      }

      return `vote_approve_${txHash}`;
    } else {
      agent['recordAction'](env.step || 0, 'vote_reject', ActionOutcome.Success);
      return 'vote_reject';
    }
  };

  const agent = new AIAgent(id, AgentRole.Governor, decisionModel, {
    useNN,
    priority,
    plugins: [consensusPlugin, roleEvolutionPlugin],
  });
  agent['personality'] = personality;
  return agent;
}
