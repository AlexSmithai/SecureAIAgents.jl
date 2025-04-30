import { AIAgent, NeuralNetModel } from '../core/agent';
import { AgentRole, ActionOutcome, AgentPlugin } from './types';
import { blockchainClient } from '../web3/blockchain';
import { callTEESecureFunction, generateZKProof } from '../tools/tee';
import { logger } from '../tools/logger';
import { commProtocol, MessageType } from '../communication/protocol';
import { gameTheoreticDecision, predictiveMarkovDecision } from '../engine/decisionModels';

// Trading-specific personality traits
interface TraderPersonality {
  riskAppetite: number; // 0 to 1, willingness to take risky trades
  marketSensitivity: number; // 0 to 1, reaction to market volatility
  tradeFrequency: number; // 0 to 1, how often to trade
  profitTarget: number; // Minimum expected profit margin (percentage)
}

// State for trader-specific data
interface TraderState {
  portfolio: Record<string, number>;
  lastTrade: { action: string; token: string; amount: number } | null;
  marketTrend: number;
  profitLoss: number;
  tradeCount: number;
}

// Plugin for market data analysis and trading
const marketAnalysisPlugin: AgentPlugin = {
  onStep: async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]) => {
    try {
      const state: TraderState = agent['state'].traderState || {
        portfolio: {},
        lastTrade: null,
        marketTrend: 0,
        profitLoss: 0,
        tradeCount: 0,
      };
      const personality: TraderPersonality = agent['personality'] || {
        riskAppetite: 0.5,
        marketSensitivity: 0.5,
        tradeFrequency: 0.5,
        profitTarget: 0.1,
      };

      // Fetch market data via MCP
      await agent['fetchMCPContext'](env.chain, 'market', { token: 'ETH' });
      const marketData = agent['mcpContext']['market']?.data || { priceChange: 0, volatility: 0 };
      state.marketTrend = marketData.priceChange;

      // Compute market volatility impact
      const volatilityImpact = marketData.volatility * personality.marketSensitivity;

      // Update portfolio based on market trend
      if (state.portfolio['ETH']) {
        state.profitLoss += state.portfolio['ETH'] * state.marketTrend;
      }

      // Share market insights with peers
      if (Math.random() < personality.tradeFrequency) {
        const insight = { token: 'ETH', trend: state.marketTrend, volatility: volatilityImpact };
        const secureInsight = callTEESecureFunction(JSON.stringify(insight));
        const proof = await generateZKProof(secureInsight);
        await commProtocol.sendMessage({
          type: MessageType.StateUpdate,
          senderId: agent.getId(),
          receiverId: 'broadcast',
          payload: { insight: JSON.parse(secureInsight), proof },
          timestamp: Date.now(),
          priority: 7,
        });
      }

      agent['state'].traderState = state;
      logger.info(`Agent ${agent.getId()} (trader) analyzed market: trend=${state.marketTrend}, P/L=${state.profitLoss}`);
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (trader) failed to analyze market: ${error.message}`);
    }
  },
};

// Plugin for swarm-based trading decisions
const swarmTradingPlugin: AgentPlugin = {
  onMessage: async (agent: AIAgent, message: any) => {
    try {
      if (message.type === MessageType.StateUpdate && message.payload.insight?.trend) {
        const state: TraderState = agent['state'].traderState || {
          portfolio: {},
          lastTrade: null,
          marketTrend: 0,
          profitLoss: 0,
          tradeCount: 0,
        };
        const personality: TraderPersonality = agent['personality'] || {
          riskAppetite: 0.5,
          marketSensitivity: 0.5,
          tradeFrequency: 0.5,
          profitTarget: 0.1,
        };

        // Adjust market trend based on peer insights
        const peerTrend = message.payload.insight.trend;
        state.marketTrend = (state.marketTrend + peerTrend) / 2;
        agent['state'].traderState = state;
        logger.info(`Agent ${agent.getId()} (trader) updated market trend to ${state.marketTrend} based on peer insight`);
      }
    } catch (error) {
      logger.error(`Agent ${agent.getId()} (trader) failed to process peer insight: ${error.message}`);
    }
  },
};

export function createTradingAgent(
  id: number,
  priority: number = 0,
  useNN: boolean = true,
  personality: TraderPersonality = { riskAppetite: 0.5, marketSensitivity: 0.5, tradeFrequency: 0.5, profitTarget: 0.1 }
): AIAgent {
  const decisionModel = async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<string> => {
    try {
      const state: TraderState = agent['state'].traderState || {
        portfolio: {},
        lastTrade: null,
        marketTrend: 0,
        profitLoss: 0,
        tradeCount: 0,
      };
      const personality: TraderPersonality = agent['personality'] || {
        riskAppetite: 0.5,
        marketSensitivity: 0.5,
        tradeFrequency: 0.5,
        profitTarget: 0.1,
      };

      // Use game-theoretic decision for trading strategy
      const cooperationScore = await gameTheoreticDecision(agent, env, agents);
      const markovPrediction = await predictiveMarkovDecision(agent, env);

      // Combine market trend, cooperation, and prediction
      let tradeScore = (state.marketTrend + cooperationScore + markovPrediction) / 3;
      tradeScore = tradeScore * personality.riskAppetite;

      // Use neural network for final decision
      if (useNN && agent['nnModel']) {
        const features = [
          state.marketTrend,
          cooperationScore,
          markovPrediction,
          personality.riskAppetite,
          state.profitLoss / 1000,
        ];
        const prediction = (agent['nnModel'] as NeuralNetModel).predict(features);
        tradeScore = prediction[0] > prediction[1] ? prediction[0] : 1 - prediction[1];
      }

      // Decide to trade if conditions are met
      if (Math.random() < personality.tradeFrequency && tradeScore > personality.profitTarget) {
        const action = state.marketTrend > 0 ? 'buy' : 'sell';
        const amount = 1; // Fixed amount for simplicity
        const token = 'ETH';
        const txHash = await blockchainClient.executeTrade(env.chain, action, token, amount);
        const outcome = txHash !== '0x0' ? ActionOutcome.Success : ActionOutcome.Failure;

        // Update portfolio and state
        state.portfolio[token] = (state.portfolio[token] || 0) + (action === 'buy' ? amount : -amount);
        state.lastTrade = { action, token, amount };
        state.tradeCount++;
        state.profitLoss += outcome === ActionOutcome.Success ? tradeScore * amount : -amount;

        // Record action and update RL
        agent['recordAction'](env.step || 0, `trade_${action}`, outcome, { txHash, token, amount }, 'trade');
        agent['lastReward'] = outcome === ActionOutcome.Success ? 1 : -1;
        if (agent['nnModel']) {
          const labels = outcome === ActionOutcome.Success ? [[1, 0]] : [[0, 1]];
          await (agent['nnModel'] as NeuralNetModel).train([[state.marketTrend, cooperationScore, markovPrediction, personality.risk
