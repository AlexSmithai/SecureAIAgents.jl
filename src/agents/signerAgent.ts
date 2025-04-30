import { AIAgent, NeuralNetModel } from '../core/agent';
import { AgentRole, ActionOutcome, AgentPlugin } from './types';
import { blockchainClient } from '../web3/blockchain';
import { callTEESecureFunction, generateZKProof } from '../tools/tee';
import { juliaInterface } from '../tools/juliaInterface';
import { logger } from '../tools/logger';
import { commProtocol, MessageType, AgentMessage } from '../communication/protocol';
import { gameTheoreticDecision, predictiveMarkovDecision } from '../engine/decisionModels';

// Signer-specific personality traits for decision-making
interface SignerPersonality {
  riskAversion: number; // 0 to 1, preference for low-risk transactions
  cooperationLevel: number; // 0 to 1, willingness to cooperate with peers
  transactionThreshold: number; // Minimum transaction value to sign (in ETH or equivalent)
  latencySensitivity: number; // 0 to 1, preference for low-latency transactions
}

// State for signer-specific data
interface SignerState {
  lastTxHash: string | null;
  pendingTransactions: Array<{ to: string; value: string; data?: string }>;
  peerActivity: Record<number, number>;
  transactionVolume: number;
  cooperationScore: number;
  gasEstimates: Record<string, number>;
  successRate: number;
}

// Transaction analytics for monitoring performance
interface TransactionAnalytics {
  totalSigned: number;
  totalFailed: number;
  averageGasCost: number;
  successRate: number;
  highValueTxCount: number; // Transactions above threshold
}

// Plugin for peer activity tracking and swarm coordination
const peerTrackingPlugin: AgentPlugin = {
  onStep: async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]) => {
    try {
      const signerAgents = agents.filter(a => a.getId() !== agent.getId() && a.getRole() === AgentRole.Signer);
      const state: SignerState = agent['state'].signerState || {
        lastTxHash: null,
        pendingTransactions: [],
        peerActivity: {},
        transactionVolume: 0,
        cooperationScore: 0,
        gasEstimates: {},
        successRate: 0,
      };

      // Track peer activity (successful transactions)
      let totalPeerActivity = 0;
      for (const peer of signerAgents) {
        const peerTxs = peer['getHistoricalActions']('sign');
        const successCount = peerTxs.filter(tx => tx.includes('success')).length;
        state.peerActivity[peer.getId()] = successCount / (peerTxs.length || 1);
        totalPeerActivity += state.peerActivity[peer.getId()];
      }
      const peerActivityRatio = signerAgents.length > 0 ? totalPeerActivity / signerAgents.length : 0;

      // Update transaction volume from MCP data
      await agent['fetchMCPContext'](env.chain, 'transactions', {});
      const mcpTxs = agent['mcpContext']['transactions']?.data || [];
      state.transactionVolume = mcpTxs.length;

      // Compute cooperation score based on communication
      const messages = await commProtocol.receiveMessages(agent.getId());
      const cooperationMessages = messages.filter(msg => msg.type === MessageType.SwarmFeedback && msg.payload.cooperation);
      state.cooperationScore = cooperationMessages.length / (messages.length || 1);

      agent['state'].signerState = state;
      logger.info(`Agent ${agent.getId()} (signer) updated peer activity ratio: ${peerActivityRatio}, tx volume: ${state.transactionVolume}, cooperation: ${state.cooperationScore}`);
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (signer) failed to track peer activity: ${error.message}`);
    }
  },
};

// Plugin for transaction batching and gas optimization
const batchProcessingPlugin: AgentPlugin = {
  onStep: async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]) => {
    try {
      const state: SignerState = agent['state'].signerState || {
        lastTxHash: null,
        pendingTransactions: [],
        peerActivity: {},
        transactionVolume: 0,
        cooperationScore: 0,
        gasEstimates: {},
        successRate: 0,
      };
      const personality: SignerPersonality = agent['personality'] || {
        riskAversion: 0.5,
        cooperationLevel: 0.5,
        transactionThreshold: 0.1,
        latencySensitivity: 0.5,
      };

      // Batch transactions if enough are pending
      if (state.pendingTransactions.length >= 3) {
        const txHashes = await blockchainClient.batchTransactions(env.chain);
        state.pendingTransactions = [];
        state.lastTxHash = txHashes[txHashes.length - 1] || null;

        // Update gas estimates
        for (const txHash of txHashes) {
          state.gasEstimates[txHash] = Math.random() * 50000; // Simulated gas cost
        }

        // Update success rate
        const successfulTxs = txHashes.filter(hash => hash !== '0x0').length;
        state.successRate = (state.successRate * (txHashes.length - successfulTxs) + successfulTxs) / txHashes.length;

        agent['state'].signerState = state;
        logger.info(`Agent ${agent.getId()} (signer) batched ${txHashes.length} transactions, success rate: ${state.successRate}`);
      }
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (signer) failed to batch transactions: ${error.message}`);
    }
  },
};

// Plugin for swarm feedback and cooperation
const swarmCooperationPlugin: AgentPlugin = {
  onMessage: async (agent: AIAgent, message: AgentMessage) => {
    try {
      if (message.type === MessageType.SwarmFeedback) {
        const state: SignerState = agent['state'].signerState || {
          lastTxHash: null,
          pendingTransactions: [],
          peerActivity: {},
          transactionVolume: 0,
          cooperationScore: 0,
          gasEstimates: {},
          successRate: 0,
        };
        const personality: SignerPersonality = agent['personality'] || {
          riskAversion: 0.5,
          cooperationLevel: 0.5,
          transactionThreshold: 0.1,
          latencySensitivity: 0.5,
        };

        // Adjust cooperation score based on feedback
        const feedback = message.payload.cooperation || 0;
        state.cooperationScore = (state.cooperationScore + feedback * personality.cooperationLevel) / (1 + personality.cooperationLevel);
        agent['state'].signerState = state;
        logger.info(`Agent ${agent.getId()} (signer) updated cooperation score to ${state.cooperationScore} based on swarm feedback`);
      }
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (signer) failed to process swarm feedback: ${error.message}`);
    }
  },
};

// Plugin for transaction analytics
const analyticsPlugin: AgentPlugin = {
  onStep: async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]) => {
    try {
      const analytics: TransactionAnalytics = agent['analytics'] || {
        totalSigned: 0,
        totalFailed: 0,
        averageGasCost: 0,
        successRate: 0,
        highValueTxCount: 0,
      };
      const state: SignerState = agent['state'].signerState || {
        lastTxHash: null,
        pendingTransactions: [],
        peerActivity: {},
        transactionVolume: 0,
        cooperationScore: 0,
        gasEstimates: {},
        successRate: 0,
      };

      // Update analytics based on historical actions
      const signedTxs = agent['getHistoricalActions']('sign');
      analytics.totalSigned = signedTxs.length;
      analytics.totalFailed = signedTxs.filter(tx => !tx.includes('success')).length;
      analytics.successRate = analytics.totalSigned > 0 ? (analytics.totalSigned - analytics.totalFailed) / analytics.totalSigned : 0;
      analytics.averageGasCost = Object.values(state.gasEstimates).reduce((sum, cost) => sum + cost, 0) / (Object.keys(state.gasEstimates).length || 1);
      analytics.highValueTxCount = signedTxs.filter(tx => {
        const metadata = agent['actionHistory']['sign'].find(action => action.action === tx)?.metadata;
        return metadata && metadata.value >= 0.5; // High-value threshold
      }).length;

      agent['analytics'] = analytics;
      logger.info(`Agent ${agent.getId()} (signer) updated analytics: ${JSON.stringify(analytics)}`);
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (signer) failed to update analytics: ${error.message}`);
    }
  },
};

export function createSignerAgent(
  id: number,
  priority: number = 0,
  useNN: boolean = false,
  personality: SignerPersonality = { riskAversion: 0.5, cooperationLevel: 0.5, transactionThreshold: 0.1, latencySensitivity: 0.5 }
): AIAgent {
  const decisionModel = async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<string> => {
    try {
      const state: SignerState = agent['state'].signerState || {
        lastTxHash: null,
        pendingTransactions: [],
        peerActivity: {},
        transactionVolume: 0,
        cooperationScore: 0,
        gasEstimates: {},
        successRate: 0,
      };
      const personality: SignerPersonality = agent['personality'] || {
        riskAversion: 0.5,
        cooperationLevel: 0.5,
        transactionThreshold: 0.1,
        latencySensitivity: 0.5,
      };

      // Fetch transaction to sign from environment
      const tx = env.transactions?.[0] || { to: '0x123...', value: '0.1' };
      const txValue = parseFloat(tx.value);

      // Check transaction threshold
      if (txValue < personality.transactionThreshold) {
        agent['recordAction'](env.step || 0, 'sign_reject', ActionOutcome.Success, { reason: 'below threshold', value: txValue }, 'sign');
        return 'sign_reject_below_threshold';
      }

      // Compute peer activity ratio
      const peerActivityRatio = Object.values(state.peerActivity).reduce((sum, val) => sum + val, 0) / (Object.keys(state.peerActivity).length || 1);

      // Use Julia for weighted
