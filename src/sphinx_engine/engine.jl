import * as tf from '@tensorflow/tfjs';
import { AIAgent, NeuralNetModel, callTEESecureFunction } from '../core/agent';
import { submitTransaction, submitVoteToContract, fetchSwarmData } from '../web3/blockchain';
import { randomVotingModel, blockHeightVotingModel, tradingModel, governanceModel, signTransaction } from './decisionModels';

// New: Analyze emergent behavior at the swarm level
export interface EmergentBehavior {
  votingConsensus?: { approveRatio: number; totalVotes: number };
  marketTrend?: { buyRatio: number; totalTrades: number };
  governanceApproval?: { approvalRatio: number; totalDecisions: number };
}

async function extractFeatures(agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<number[]> {
  const blockHeight = env.blockHeight || 0;
  const pastVotes = Object.values(env.consensus || {});
  const voteRatio = pastVotes.length > 0 ? pastVotes.filter(v => v === 'eurt').length / pastVotes.length : 0.5;
  const actionCount = agent.state.vote ? 1 : 0;

  // New: Influence from other agents' historical behavior
  const peerInfluence = agents
    .filter(a => a.id !== agent.id && (a.role === agent.role || a.role === 'voter' || a.role === 'trader' || a.role === 'governor'))
    .map(a => a.getHistoricalActions(agent.role === 'trader' ? 'trade' : agent.role === 'voter' ? 'vote' : 'decision'))
    .flat()
    .reduce((acc: number, action: any) => acc + (action === 'buy' || action === true || action === 'approve' ? 1 : -1), 0);

  const influenceFactor = peerInfluence / Math.max(1, agents.length - 1);
  return [blockHeight, voteRatio, actionCount, influenceFactor, env.blockHeight ? 1 : 0]; // Updated for ABM
}

async function neuralNetVotingModel(agent: AIAgent, env: Record<string, any>, nnModel: NeuralNetModel, agents: AIAgent[]): Promise<boolean> {
  const features = await extractFeatures(agent, env, agents);
  const inputTensor = tf.tensor2d([features]);
  const probs = nnModel.model.predict(inputTensor) as tf.Tensor;
  const decision = (await probs.argMax(1).data())[0] === 1;
  nnModel.history.push([features, decision]);
  
  if (nnModel.history.length >= 10) {
    await trainNeuralNet(nnModel);
  }
  return decision;
}

async function trainNeuralNet(nnModel: NeuralNetModel): Promise<void> {
  if (nnModel.history.length < 2) return;

  const features = nnModel.history.map(h => h[0]);
  const labels = nnModel.history.map(h => h[1] ? [0, 1] : [1, 0]);
  const xs = tf.tensor2d(features);
  const ys = tf.tensor2d(labels);

  let patienceCounter = 0;
  for (let epoch = 0; epoch < 20; epoch++) {
    const history = await nnModel.model.fit(xs, ys, { epochs: 1, verbose: 0 });
    const currentLoss = history.history.loss[0] as number;
    if (currentLoss < nnModel.bestLoss) {
      nnModel.bestLoss = currentLoss;
      patienceCounter = 0;
    } else {
      patienceCounter++;
    }
    if (patienceCounter >= 3) {
      console.log(`Early stopping at epoch ${epoch} with loss ${currentLoss}`);
      break;
    }
  }
  nnModel.history = [];
  console.log(`Trained neural network with ${labels.length} samples, final loss: ${nnModel.bestLoss}`);
}

export async function sendMessage(agent: AIAgent, env: Record<string, any>, message: string): Promise<void> {
  if (!env.messages) env.messages = {};
  if (!env.messages[agent.id]) env.messages[agent.id] = [];
  env.messages[agent.id].push(message);
  console.log(`Agent ${agent.id} sent message: ${message}`);
}

export async function receiveMessages(agent: AIAgent, env: Record<string, any>): Promise<string[]> {
  if (!env.messages) return [];
  const messages: string[] = [];
  for (const senderId in env.messages) {
    if (parseInt(senderId) !== agent.id) {
      messages.push(...env.messages[senderId]);
    }
  }
  return messages;
}

// New: Elect a leader for swarm coordination
export async function electLeader(agents: AIAgent[]): Promise<AIAgent> {
  return agents.reduce((leader, agent) => {
    const leaderScore = leader.actionHistory.reduce((sum, entry) => sum + (entry.outcome === 'success' ? 1 : 0), 0);
    const agentScore = agent.actionHistory.reduce((sum, entry) => sum + (entry.outcome === 'success' ? 1 : 0), 0);
    return agentScore > leaderScore ? agent : leader;
  }, agents[0]);
}

// New: Analyze emergent behavior in the swarm
export async function analyzeEmergentBehavior(agents: AIAgent[]): Promise<EmergentBehavior> {
  const voterAgents = agents.filter(a => a.role === 'voter' || a.role === 'governor');
  const tradingAgents = agents.filter(a => a.role === 'trader');
  const governanceAgents = agents.filter(a => a.role === 'governor');

  const votingConsensus = voterAgents.length > 0 ? {
    approveRatio: voterAgents.reduce((sum, a) => sum + (a.getHistoricalActions('vote').filter(v => v === true).length), 0) / (voterAgents.length * 10),
    totalVotes: voterAgents.reduce((sum, a) => sum + a.getHistoricalActions('vote').length, 0)
  } : undefined;

  const marketTrend = tradingAgents.length > 0 ? {
    buyRatio: tradingAgents.reduce((sum, a) => sum + (a.getHistoricalActions('trade').filter(t =>
