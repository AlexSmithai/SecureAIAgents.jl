import { AIAgent, NeuralNetModel } from '../core/agent';
import { AgentRole, ActionOutcome, AgentPlugin } from './types';
import { blockchainClient } from '../web3/blockchain';
import { callTEESecureFunction, generateZKProof } from '../tools/tee';
import { logger } from '../tools/logger';
import { commProtocol, MessageType } from '../communication/protocol';
import { gameTheoreticDecision } from '../engine/decisionModels';

// Reader-specific personality traits
interface ReaderPersonality {
  curiosity: number; // 0 to 1, eagerness to fetch new data
  sharingLikelihood: number; // 0 to 1, likelihood of sharing insights
  accuracyThreshold: number; // 0 to 1, minimum confidence for sharing
}

// State for reader-specific data
interface ReaderState {
  lastBlockHeight: number;
  blockchainData: Record<string, any>;
  sharedInsights: number;
  insightAccuracy: number;
}

// Plugin for blockchain data fetching and sharing
const dataFetchPlugin: AgentPlugin = {
  onStep: async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]) => {
    try {
      const state: ReaderState = agent['state'].readerState || {
        lastBlockHeight: 0,
        blockchainData: {},
        sharedInsights: 0,
        insightAccuracy: 0,
      };
      const personality: ReaderPersonality = agent['personality'] || {
        curiosity: 0.7,
        sharingLikelihood: 0.5,
        accuracyThreshold: 0.8,
      };

      // Fetch blockchain data if curious
      if (Math.random() < personality.curiosity) {
        const blockHeight = await blockchainClient.readBlockchainData(env.chain);
        if (blockHeight > state.lastBlockHeight) {
          state.lastBlockHeight = blockHeight;
          state.blockchainData[blockHeight] = {
            timestamp: Date.now(),
            transactions: env.transactions || [],
          };

          // Compute insight (e.g., transaction volume trend)
          const recentBlocks = Object.keys(state.blockchainData)
            .sort((a, b) => Number(b) - Number(a))
            .slice(0, 5);
          const txCounts = recentBlocks.map(block => state.blockchainData[block].transactions.length);
          const trend = txCounts.length > 1 ? (txCounts[0] - txCounts[txCounts.length - 1]) / txCounts.length : 0;

          // Share insight if above accuracy threshold
          const insightAccuracy = Math.abs(trend) > 0.1 ? 0.9 : 0.6; // Simulated accuracy
          if (insightAccuracy >= personality.accuracyThreshold && Math.random() < personality.sharingLikelihood) {
            const insight = { blockHeight, trend, accuracy: insightAccuracy };
            const secureInsight = callTEESecureFunction(JSON.stringify(insight));
            const proof = await generateZKProof(secureInsight);

            await commProtocol.sendMessage({
              type: MessageType.StateUpdate,
              senderId: agent.getId(),
              receiverId: 'broadcast',
              payload: { insight: JSON.parse(secureInsight), proof },
              timestamp: Date.now(),
              priority: 6,
            });
            state.sharedInsights++;
            state.insightAccuracy = (state.insightAccuracy * (state.sharedInsights - 1) + insightAccuracy) / state.sharedInsights;
          }
        }
      }

      agent['state'].readerState = state;
      logger.info(`Agent ${agent.getId()} (reader) fetched block ${state.lastBlockHeight}, shared ${state.sharedInsights} insights, accuracy: ${state.insightAccuracy}`);
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (reader) failed to fetch data: ${error.message}`);
    }
  },
};

// Plugin for swarm feedback processing
const swarmFeedbackPlugin: AgentPlugin = {
  onMessage: async (agent: AIAgent, message: any) => {
    try {
      if (message.type === MessageType.SwarmFeedback) {
        const feedback = message.payload.accuracyFeedback || 0;
        const state: ReaderState = agent['state'].readerState || {
          lastBlockHeight: 0,
          blockchainData: {},
          sharedInsights: 0,
          insightAccuracy: 0,
        };
        state.insightAccuracy = (state.insightAccuracy + feedback) / 2;
        agent['state'].readerState = state;
        logger.info(`Agent ${agent.getId()} (reader) updated insight accuracy to ${state.insightAccuracy} based on swarm feedback`);
      }
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (reader) failed to process swarm feedback: ${error.message}`);
    }
  },
};

export function createReaderAgent(
  id: number,
  priority: number = 0,
  useNN: boolean = false,
  personality: ReaderPersonality = { curiosity: 0.7, sharingLikelihood: 0.5, accuracyThreshold: 0.8 }
): AIAgent {
  const decisionModel = async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<string> => {
    try {
      const state: ReaderState = agent['state'].readerState || {
        lastBlockHeight: 0,
        blockchainData: {},
        sharedInsights: 0,
        insightAccuracy: 0,
      };
      const personality: ReaderPersonality = agent['personality'] || {
        curiosity: 0.7,
        sharingLikelihood: 0.5,
        accuracyThreshold: 0.8,
      };

      // Use game-theoretic decision to determine if sharing is beneficial
      const cooperationScore = await gameTheoreticDecision(agent, env, agents);
      const shouldShare = cooperationScore > 0.5 && Math.random() < personality.sharingLikelihood;

      if (shouldShare && state.lastBlockHeight > 0) {
        const insight = {
          blockHeight: state.lastBlockHeight,
          txCount: state.blockchainData[state.lastBlockHeight].transactions.length,
          accuracy: state.insightAccuracy,
        };
        agent['recordAction'](env.step || 0, 'read_share', ActionOutcome.Success, { insight }, 'read');
        return `read_share_block_${state.lastBlockHeight}`;
      } else {
        agent['recordAction'](env.step || 0, 'read_skip', ActionOutcome.Success, {}, 'read');
        return 'read_skip';
      }
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (reader) decision failed: ${error.message}`);
      return 'read_skip';
    }
  };

  const agent = new AIAgent(id, AgentRole.Reader, decisionModel, {
    useNN,
    priority,
    plugins: [dataFetchPlugin, swarmFeedbackPlugin],
  });
  agent['personality'] = personality;
  return agent;
}
