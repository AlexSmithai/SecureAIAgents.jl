import * as tf from '@tensorflow/tfjs';
import * as fs from 'fs';
import { spawnSync } from 'child_process';
import { mcpClient, MCPResponse } from '../web3/mcpClient';

export class NeuralNetModel {
  model: tf.LayersModel;
  history: Array<[number[], boolean]>;
  bestLoss: number;

  constructor() {
    this.model = tf.sequential();
    this.model.add(tf.layers.dense({ units: 20, activation: 'relu', inputShape: [5] })); // Increased input shape for ABM features
    this.model.add(tf.layers.dense({ units: 10, activation: 'relu' }));
    this.model.add(tf.layers.dense({ units: 2, activation: 'softmax' }));
    this.model.compile({ optimizer: 'adam', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
    this.history = [];
    this.bestLoss = Infinity;
  }
}

export class AIAgent {
  id: number;
  role: string;
  state: Record<string, any>;
  decisionModel: (agent: AIAgent, env: Record<string, any>) => Promise<boolean | string>;
  nnModel: NeuralNetModel | null;
  priority: number;
  mcpContext: Record<string, MCPResponse>;
  actionHistory: Array<{ step: number; action: any; outcome: any }>; // New: Track agent history for ABM

  constructor(
    id: number,
    role: string,
    decisionModel: (agent: AIAgent, env: Record<string, any>) => Promise<boolean | string>,
    useNN: boolean = false,
    priority: number = 0
  ) {
    this.id = id;
    this.role = role;
    this.state = { key: '', vote: null, txHash: null, blockHeight: 0, balance: 0.0 };
    this.decisionModel = decisionModel;
    this.nnModel = useNN ? new NeuralNetModel() : null;
    this.priority = priority;
    this.mcpContext = {};
    this.actionHistory = []; // Initialize action history
  }

  // New: Record an action and its outcome for ABM
  recordAction(step: number, action: any, outcome: any): void {
    this.actionHistory.push({ step, action, outcome });
    if (this.actionHistory.length > 100) {
      this.actionHistory.shift(); // Keep history manageable
    }
  }

  // New: Get historical actions for a specific type (e.g., votes, trades)
  getHistoricalActions(type: 'vote' | 'trade' | 'decision'): Array<any> {
    return this.actionHistory
      .filter(entry => {
        if (type === 'vote' && (this.role === 'voter' || this.role === 'governor')) return true;
        if (type === 'trade' && this.role === 'trader') return true;
        if (type === 'decision' && this.role === 'governor') return true;
        return false;
      })
      .map(entry => entry.action);
  }

  async fetchMCPContext(chain: string, type: 'votes' | 'market' | 'proposals', params: any = {}): Promise<void> {
    let response: MCPResponse;
    if (type === 'votes' || type === 'transactions') {
      response = await mcpClient.fetchHistoricalData(chain, type, params);
    } else if (type === 'market') {
      response = await mcpClient.fetchMarketData(chain, params.token);
    } else {
      response = await mcpClient.fetchGovernanceProposals(chain, params.contractAddress);
    }
    this.mcpContext[type] = response;
  }

  async step(env: Record<string, any>): Promise<void> {
    // Defined in engine.ts
  }
}

export function callTEESecureFunction(input: string): string {
  const result = spawnSync('node', [
    '-e',
    `const ffi = require('ffi-napi');` +
    `const lib = ffi.Library('lib/libtee', { 'tee_secure_process': ['string', ['string']] });` +
    `console.log(lib.tee_secure_process('${input}'));`
  ], { encoding: 'utf8' });

  if (result.error) {
    throw new Error(`Failed to call TEE function: ${result.error.message}`);
  }

  const output = result.stdout.trim();
  return output || input.split('').reverse().join('');
}

export function saveState(agent: AIAgent, filepath: string): void {
  const stateDict = {
    id: agent.id,
    role: agent.role,
    state: agent.state,
    history: agent.nnModel ? agent.nnModel.history : [],
    mcpContext: agent.mcpContext,
    actionHistory: agent.actionHistory // Save action history
  };
  fs.writeFileSync(filepath, JSON.stringify(stateDict, null, 2));
  console.log(`Saved agent ${agent.id} state to ${filepath}`);
}

export function loadState(agent: AIAgent, filepath: string): void {
  if (!fs.existsSync(filepath)) {
    console.warn(`State file ${filepath} not found for agent ${agent.id}`);
    return;
  }
  const stateDict = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  agent.state = stateDict.state;
  if (agent.nnModel) {
    agent.nnModel.history = stateDict.history;
  }
  agent.mcpContext = stateDict.mcpContext || {};
  agent.actionHistory = stateDict.actionHistory || [];
  console.log(`Loaded agent ${agent.id} state from ${filepath}`);
}
