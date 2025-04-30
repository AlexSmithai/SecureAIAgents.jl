import { AIAgent, NeuralNetModel } from '../core/agent';
import { AgentRole, ActionOutcome, AgentPlugin, ConsensusRequest, ConsensusResponse } from './types';
import { submitVote } from '../web3/blockchain';
import { callTEESecureFunction, generateZKProof } from '../tools/tee';
import { juliaInterface } from '../tools/juliaInterface';
import { logger } from '../tools/logger';
import { commProtocol, MessageType } from '../communication/protocol';
import { gameTheoreticDecision, predictiveMarkovDecision } from '../engine/decisionModels';

// Voter-specific personality traits
interface VoterPersonality {
  riskTolerance: number; // 0 to 1
  peerInfluence: number; // 0 to 1
  confidenceThreshold: number; // 0 to 1
}

// State for voter-specific data
interface VoterState {
  lastVote: boolean | null;
  peerVotes: Record<number, boolean>;
  mcpRatio: number;
}

// Plugin for peer vote tracking
const peerTrackingPlugin: AgentPlugin = {
  onStep: async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]) => {
    try {
      const voterAgents = agents.filter(a => a.getId() !== agent.getId() && a.getRole() === AgentRole.Voter);
      const state: VoterState = agent['state'].voterState || { lastVote: null, peerVotes: {}, mcpRatio: 0 };
      let peerRatio = 0;

      // Collect peer votes
      for (const peer of voterAgents) {
        const peerAction = peer['getHistoricalActions']('vote').slice(-1)[0];
        if (peerAction !== undefined) {
          state.peerVotes[peer.getId()] = peerAction === 'vote_approve';
          peerRatio += state.peerVotes[peer.getId()] ? 1 : 0;
        }
      }
      peerRatio = voterAgents.length > 0 ? peerRatio / voterAgents.length : 0;

      // Fetch MCP data for voting context
      await agent['fetchMCPContext'](env.chain, 'votes', {});
      const mcpVotes = agent['mcpContext']['votes']?.data || [];
      state.mcpRatio = mcpVotes.length > 0 ? mcpVotes.filter((v: boolean) => v).length / mcpVotes.length : 0;

      agent['state'].voterState = state;
      logger.info(`Agent ${agent.getId()} (voter) updated peer ratio: ${peerRatio}, MCP ratio: ${state.mcpRatio}`);
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (voter) failed to track peers: ${error.message}`);
    }
  },
};

// Plugin for consensus participation
const consensusPlugin: AgentPlugin = {
  onMessage: async (agent: AIAgent, message: any) => {
    if (message.type === MessageType.ConsensusRequest) {
      try {
        const request: ConsensusRequest = message.payload;
        const state: VoterState = agent['state'].voterState || { lastVote: null, peerVotes: {}, mcpRatio: 0 };
        const personality: VoterPersonality = agent['personality'] || { riskTolerance: 0.5, peerInfluence: 0.5, confidenceThreshold: 0.7 };

        // Compute vote using peer and MCP data
        const peerRatio = Object.values(state.peerVotes).filter(v => v).length / (Object.keys(state.peerVotes).length || 1);
        const decisionWeights = await juliaInterface.executeJLDecision(
          'src/agents/voterAgent.jl',
          peerRatio,
          state.mcpRatio,
          personality.riskTolerance
        );
        const parsedWeights = JSON.parse(decisionWeights);
        const decisionScore = parsedWeights.decision === 'approve' ? parsedWeights.score : 1 - parsedWeights.score;

        // Respond to consensus request
        const response: ConsensusResponse = {
          proposalId: request.proposalId,
          vote: decisionScore > personality.confidenceThreshold ? 'approve' : 'reject',
          confidence: decisionScore,
        };
        await commProtocol.sendMessage({
          type: MessageType.ConsensusResponse,
          senderId: agent.getId(),
          receiverId: message.senderId,
          payload: response,
          timestamp: Date.now(),
          priority: 8,
        });
        logger.info(`Agent ${agent.getId()} (voter) responded to consensus request ${request.proposalId}: ${response.vote}`);
      } catch (error) {
        logger.error(`Agent ${agent.getId()} (voter) failed to process consensus request: ${error.message}`);
      }
    }
  },
};

export function createVoterAgent(
  id: number,
  priority: number = 0,
  useNN: boolean = false,
  personality: VoterPersonality = { riskTolerance: 0.5, peerInfluence: 0.5, confidenceThreshold: 0.7 }
): AIAgent {
  const decisionModel = async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<string> => {
    try {
      const state: VoterState = agent['state'].voterState || { lastVote: null, peerVotes: {}, mcpRatio: 0 };
      const personality: VoterPersonality = agent['personality'] || { riskTolerance: 0.5, peerInfluence: 0.5, confidenceThreshold: 0.7 };

      // Compute peer and MCP ratios
      const peerRatio = Object.values(state.peerVotes).filter(v => v).length / (Object.keys(state.peerVotes).length || 1);
      const mcpRatio = state.mcpRatio;

      // Use Julia for weighted decision
      const decisionWeights = await juliaInterface.executeJLDecision(
        'src/agents/voterAgent.jl',
        peerRatio,
        mcpRatio,
        personality.riskTolerance
      );
      const parsedWeights = JSON.parse(decisionWeights);
      let decisionScore = parsedWeights.decision === 'approve' ? parsedWeights.score : 1 - parsedWeights.score;

      // Incorporate game-theoretic decision
      const gameScore = await gameTheoreticDecision(agent, env, agents);
      decisionScore = (decisionScore + gameScore * personality.peerInfluence) / (1 + personality.peerInfluence);

      // Use Markov model for prediction
      const markovScore = await predictiveMarkovDecision(agent, env);
      decisionScore = (decisionScore + markovScore * 0.3) / 1.3;

      // Use neural network if enabled
      if (useNN && agent['nnModel']) {
        const features = [
          peerRatio,
          mcpRatio,
          personality.riskTolerance,
          env.blockHeight / 1000,
          agent['lastReward'],
        ];
        const prediction = (agent['nnModel'] as NeuralNetModel).predict(features);
        decisionScore = prediction[0] > prediction[1] ? prediction[0] : 1 - prediction[1];
      }

      // Make final decision
      const shouldApprove = decisionScore > personality.confidenceThreshold;
      state.lastVote = shouldApprove;
      agent['state'].voterState = state;

      if (shouldApprove) {
        const secureVote = agent['secureDecision']('approve');
        const proof = await generateZKProof(secureVote);
        const txHash = await submitVote(env.chain, true);
        const outcome = txHash !== '0x0' ? ActionOutcome.Success : ActionOutcome.Failure;
        agent['recordAction'](env.step || 0, 'vote_approve', outcome, { txHash, proof }, 'vote');

        // Update RL
        agent['lastReward'] = outcome === ActionOutcome.Success ? 1 : -1;
        if (agent['nnModel']) {
          const labels = outcome === ActionOutcome.Success ? [[1, 0]] : [[0, 1]];
          await (agent['nnModel'] as NeuralNetModel).train([[peerRatio, mcpRatio, personality.riskTolerance, env.blockHeight / 1000, agent['lastReward']]], labels);
        }

        return `vote_approve_${txHash}`;
      } else {
        agent['recordAction'](env.step || 0, 'vote_reject', ActionOutcome.Success, {}, 'vote');
        return 'vote_reject';
      }
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (voter) decision failed: ${error.message}`);
      return 'vote_reject';
    }
  };

  const agent = new AIAgent(id, AgentRole.Voter, decisionModel, {
    useNN,
    priority,
    plugins: [peerTrackingPlugin, consensusPlugin],
  });
  agent['personality'] = personality;
  return agent;
}
