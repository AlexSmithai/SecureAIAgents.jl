import * as tf from '@tensorflow/tfjs';
import { AgentRole, AgentState, AgentAction, ActionOutcome, DecisionModel, AgentPlugin } from '../agents/types';
import { mcpClient, MCPResponse } from '../web3/mcpClient';
import { saveAgentState, loadAgentState } from './state';
import { callTEESecureFunction } from '../tools/tee';
import { logger } from '../tools/logger';
import { RLEngine } from '../engine/rlEngine';

export class NeuralNetModel {
  private model: tf.LayersModel;
  private history: Array<[number[], boolean]>;
  private bestLoss: number;

  constructor(inputShape: number = 5) {
    this.model = tf.sequential();
    this.model.add(tf.layers.dense({ units: 20, activation: 'relu', inputShape: [inputShape] }));
    this.model.add(tf.layers.dense({ units: 10, activation: 'relu' }));
    this.model.add(tf.layers.dense({ units: 2, activation: 'softmax' }));
    this.model.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
    this.history = [];
    this.bestLoss = Infinity;
  }

  async train(features: number[][], labels: number[][]): Promise<void> {
    const xs = tf.tensor2d(features);
    const ys = tf.tensor2d(labels);
    await this.model.fit(xs, ys, { epochs: 10, verbose: 0 });
    xs.dispose();
    ys.dispose();
    this.history.push(...features.map((f, i) => [f, labels[i][0] === 1] as [number[], boolean]));
    if (this.history.length > 1000) this.history.shift();
  }

  predict(input: number[]): number[] {
    const tensor = tf.tensor2d([input]);
    const prediction = this.model.predict(tensor) as tf.Tensor;
    const result = prediction.dataSync();
    tensor.dispose();
    prediction.dispose();
    return Array.from(result);
  }
}

export class AIAgent {
  private id: number;
  private role: AgentRole;
  private state: AgentState;
  private decisionModel: DecisionModel;
  private nnModel: NeuralNetModel | null;
  private priority: number;
  private mcpContext: Record<string, MCPResponse>;
  private actionHistory: AgentAction[];
  private plugins: AgentPlugin[];
  private rlEngine: RLEngine;
  private lastReward: number;

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
    this.state = { key: '', vote: null, txHash: null, blockHeight: 0, balance: 0.0 };
    this.decisionModel = decisionModel;
    this.nnModel = options.useNN ? new NeuralNetModel(options.inputShape) : null;
    this.priority = options.priority || 0;
    this.mcpContext = {};
    this.actionHistory = [];
    this.plugins = options.plugins || [];
    this.rlEngine = new RLEngine();
    this.lastReward = 0;
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
    this.priority = newPriority;
    logger.info(`Agent ${this.id} priority updated to ${newPriority}`);
  }

  recordAction(step: number, action: boolean | string, outcome: ActionOutcome, metadata: Record<string, any> = {}): void {
    const agentAction: AgentAction = { step, action, outcome, metadata };
    this.actionHistory.push(agentAction);
    if (this.actionHistory.length > 100) {
      this.actionHistory.shift();
    }
    this.last
