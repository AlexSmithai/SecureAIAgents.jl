import * as tf from '@tensorflow/tfjs';
import { AgentRole, AgentState, AgentAction, ActionOutcome, DecisionModel, AgentPlugin } from '../agents/types';
import { mcpClient, MCPResponse } from '../web3/mcpClient';
import { callTEESecureFunction } from '../tools/tee';
import { logger } from '../tools/logger';
import { RLEngine } from '../engine/rlEngine';
import { commProtocol, AgentMessage, MessageType } from '../communication/protocol';

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

// Core agent class with communication capabilities
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
  public personality: any;
  private receivedMessages: AgentMessage[];
  private communicationInfluence: Map<number, number>;

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
    this.receivedMessages = [];
    this.communicationInfluence = new Map();
    this.setupCommunicationListeners();
    logger.info(`Agent ${this.id} initialized as ${role} with priority ${this.priority}`);
  }

  private setupCommunicationListeners(): void {
    // Listener for state updates
    commProtocol.registerListener(MessageType.StateUpdate, async (msg: AgentMessage) => {
      if (msg.senderId !== this.id) {
        this.communicationInfluence.set(msg.senderId, (this.communicationInfluence.get(msg.senderId) || 0) + 0.1);
        this.receivedMessages.push(msg);
        logger.debug(`Agent ${this.id}
