import * as tf from '@tensorflow/tfjs';
import { AgentRole, AgentState, AgentAction, ActionOutcome, DecisionModel, AgentPlugin } from '../agents/types';
import { mcpClient, MCPResponse } from '../web3/mcpClient';
import { callTEESecureFunction } from '../tools/tee';
import { logger } from '../tools/logger';
import { RLEngine } from '../engine/rlEngine';

// Neural network model for RL
export class NeuralNetModel {
  private model: tf.LayersModel;
  private history: Array<[number[], boolean]>;
  private bestLoss: number;
  private inputShape: number;

  constructor(inputShape: number = 5) {
    this.inputShape = inputShape;
    this.model = tf.sequential();
    this.model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [inputShape] }));
    this.model.add(tf.layers.dropout({ rate: 0.2 }));
    this.model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    this.model.add(tf.layers.dropout({ rate: 0.2 }));
    this.model.add(tf.layers.dense({ units: 16, activation: 'relu' }));
    this.model.add(tf.layers.dense({ units: 2, activation: 'softmax' }));
    this.model.compile({
      optimizer: tf.train.adam(0.001),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy'],
    });
    this.history = [];
    this.bestLoss = Infinity;
    logger.info(`NeuralNetModel initialized with input shape ${inputShape}`);
  }

  async train(features: number[][], labels: number[][]): Promise<void> {
    try {
      const xs = tf.tensor2d(features);
      const ys = tf.tensor2d(labels);
      const history = await this.model.fit(xs, ys, {
        epochs: 20,
        batchSize: 32,
        validationSplit: 0.2,
        verbose: 0,
      });
      const loss = history.history.loss[history.history.loss.length - 1] as number;
      if (loss < this.bestLoss) {
        this.bestLoss = loss;
        logger.info(`New best loss for NeuralNetModel: ${this.bestLoss}`);
      }
      xs.dispose();
      ys.dispose();
      this.history.push(...features.map((f, i) => [f, labels[i][0] === 1] as [number[], boolean]));
      if (this.history.length > 1000) this.history.shift();
    } catch (error) {
      logger.error(`Failed to train NeuralNetModel: ${error.message}`);
    }
  }

  predict(input: number[]): number[] {
    try {
      const tensor = tf.tensor2d([input]);
      const prediction = this.model.predict(tensor) as tf.Tensor;
      const result = prediction.dataSync();
      tensor.dispose();
      prediction.dispose();
      return Array.from(result);
    } catch (error) {
      logger.error(`Failed to predict with NeuralNetModel: ${error.message}`);
      return [0.5, 0.5];
    }
  }

  getTrainingStats(): { bestLoss: number; historySize: number } {
    return { bestLoss: this.bestLoss, historySize: this.history.length };
  }
}

// Core agent class
export class AIAgent {
  private id: number;
  public role: AgentRole;
  private state: AgentState;
  private decisionModel: DecisionModel;
  private nnModel: NeuralNetModel | null;
  private priority: number;
  public mcpContext: Record<string, MCPResponse>;
  private actionHistory: Record<string, AgentAction[]>;
  private plugins: AgentPlugin[];
  public rlEngine: RLEngine;
  public lastReward: number;
  public personality: any; // Role-specific personality traits

  constructor(
    id: number,
    role: AgentRole,
    decisionModel: DecisionModel,
    options: {
      useNN?: boolean;
      priority?: number;
      plugins?: AgentPlugin[];
      inputShape?: number;
    } = {}
  ) {
    this.id = id;
    this.role = role;
    this.state = { key: '', vote: null, txHash: null, blockHeight: 0, balance: 0.0, portfolio: { assets: {}, value: 0 }, consensusState: null, markovState: null };
    this.decisionModel = decisionModel;
    this.nnModel = options.useNN ? new NeuralNetModel(options.inputShape) : null;
    this.priority = options.priority || 0;
    this.mcpContext = {};
    this.actionHistory = { vote: [], sign: [], read: [], trade: [], decision: [] };
    this.plugins = options.plugins || [];
    this.rlEngine = new RLEngine();
    this.lastReward = 0;
    this.personality = null;
    logger.info(`Agent ${this.id} initialized as ${role} with priority ${this.priority}`);
  }

  getId(): number {
    return this.id;
  }

  getRole(): AgentRole {
    return this.role;
  }

  getPriority(): number {
    return this.priority;
  }

  updatePriority(newPriority: number): void {
    try {
      this.priority = newPriority;
      logger.info(`Agent ${this.id} priority updated to ${newPriority}`);
    } catch (error) {
      logger.error(`Agent ${this.id} failed to update priority: ${error.message}`);
    }
  }

  recordAction(step: number, action: boolean | string, outcome: ActionOutcome, metadata: Record<string, any> = {}, type: 'vote' | 'sign' | 'read' | 'trade' | 'decision' = 'decision'): void {
    try {
      const agentAction: AgentAction = { step, action, outcome, metadata };
      this.actionHistory[type].push(agentAction);
      if (this.actionHistory[type].length > 100) {
        this.actionHistory[type].shift();
      }
      logger.debug(`Agent ${this.id} recorded ${type} action: ${JSON.stringify(agentAction)}`);
    } catch (error) {
      logger.error(`Agent ${this.id} failed to record action: ${error.message}`);
    }
  }

  getHistoricalActions(type: 'vote' | 'sign' | 'read' | 'trade' | 'decision'): (boolean | string)[] {
    return this.actionHistory[type].map(action => action.action);
  }

  async fetchMCPContext(chain: string, type: string, params: any): Promise<void> {
    try {
      if (type === 'votes' || type === 'transactions') {
        this.mcpContext[type] = await mcpClient.fetchHistoricalData(chain, type, params);
      } else if (type === 'market') {
        this.mcpContext[type] = await mcpClient.fetchMarketData(chain, params.token);
      } else if (type === 'proposals') {
        this.mcpContext[type] = await mcpClient.fetchGovernanceProposals(chain, params.contractAddress);
      }
      logger.info(`Agent ${this.id} fetched MCP context for ${type}`);
    } catch (error) {
      logger.error(`Agent ${this.id} failed to fetch MCP context for ${type}: ${error.message}`);
    }
  }

  secureDecision(decision: string): string {
    try {
      const secureDecision = callTEESecureFunction(decision);
      logger.info(`Agent ${this.id} secured decision: ${secureDecision}`);
      return secureDecision;
    } catch (error) {
      logger.error(`Agent ${this.id} failed to secure decision: ${error.message}`);
      return decision;
    }
  }

  async step(env: Record<string, any>, agents: AIAgent[]): Promise<void> {
    try {
      // Run plugins' onStep hooks
      for (const plugin of this.plugins) {
        if (plugin.onStep) {
          await plugin.onStep(this, env, agents);
        }
      }

      // Execute decision model
      const decision = await this.decisionModel(this, env, agents);
      logger.debug(`Agent ${this.id} made decision: ${decision}`);

      // Run plugins' onDecision hooks
      for (const plugin of this.plugins) {
        if (plugin.onDecision) {
          await plugin.onDecision(this, decision);
        }
      }
    } catch (error) {
      logger.error(`Agent ${this.id} failed to execute step: ${error.message}`);
    }
  }

  getAgentStats(): { actions: number; successRate: number; priority: number } {
    try {
      const allActions = Object.values(this.actionHistory).flat();
      const totalActions = allActions.length;
      const successRate = totalActions > 0 ? allActions.filter(a => a.outcome === 'success').length / totalActions : 0;
      return { actions: totalActions, successRate, priority: this.priority };
    } catch (error) {
      logger.error(`Agent ${this.id} failed to compute stats: ${error.message}`);
      return { actions: 0, successRate: 0, priority: this.priority };
    }
  }
}
