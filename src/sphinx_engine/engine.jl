import * as tf from '@tensorflow/tfjs';
import { AIAgent, NeuralNetModel, callTEESecureFunction } from '../core/agent';
import { submitTransaction, submitVoteToContract, fetchSwarmData } from '../web3/blockchain';
import { randomVotingModel, blockHeightVotingModel, tradingModel, governanceModel, signTransaction } from './decisionModels';

export interface EmergentBehavior {
 votingConsensus?: { approveRatio: number; totalVotes: number };
 marketTrend?: { buyRatio: number; totalTrades: number };
 governanceApproval?: { approvalRatio: number; totalDecisions: number };
}

async function extractFeatures(agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<number[]> {
 const blockHeight = env.blockHeight || 0;
 const pastVotes = Object.values(env.consensus || {});
 const voteRatio = pastVotes.length > 0 ? pastVotes.filter(v => v === true).length / pastVotes.length : 0.5; // Fixed: 'eurt' to true
 const actionCount = agent.state.vote ? 1 : 0;

 const peerInfluence = agents
 .filter(a => a.id !== agent.id && (a.role === agent.role || a.role === 'voter' || a.role === 'trader' || a.role === 'governor'))
 .map(a => a.getHistoricalActions(agent.role === 'trader' ? 'trade' : agent.role === 'voter' ? 'vote' : 'decision'))
 .flat()
 .reduce((acc: number, action: any) => acc + (action === 'buy' || action === true || action === 'approve' ? 1 : -1), 0);

 const influenceFactor = peerInfluence / Math.max(1, agents.length - 1);

 // New: Incorporate MCP data (e.g., market trend) into features
 let marketTrend = 0.5;
 if (agent.mcpContext['market']?.data) {
 const marketData = agent.mcpContext['market'].data;
 marketTrend = marketData.priceChange > 0 ? 1 : 0; // Simplified: 1 for upward trend, 0 for downward
 }

 return [blockHeight, voteRatio, actionCount, influenceFactor, marketTrend]; // Updated for MCP data
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

export async function electLeader(agents: AIAgent[]): Promise<AIAgent> {
 return agents.reduce((leader, agent) => {
 const leaderScore = leader.actionHistory.reduce((sum, entry) => sum + (entry.outcome === 'success' ? 1 : 0), 0);
 const agentScore = agent.actionHistory.reduce((sum, entry) => sum + (entry.outcome === 'success' ? 1 : 0), 0);
 // New: Break ties using priority
 if (agentScore === leaderScore) {
 return agent.priority > leader.priority ? agent : leader;
 }
 return agentScore > leaderScore ? agent : leader;
 }, agents[0]);
}

export async function analyzeEmergentBehavior(agents: AIAgent[]): Promise<EmergentBehavior> {
 const voterAgents = agents.filter(a => a.role === 'voter' || a.role === 'governor');
 const tradingAgents = agents.filter(a => a.role === 'trader');
 const governanceAgents = agents.filter(a => a.role === 'governor');

 const votingConsensus = voterAgents.length > 0 ? {
 approveRatio: voterAgents.reduce((sum, a) => {
 const votes = a.getHistoricalActions('vote');
 return sum + (votes.filter(v => v === true).length / Math.max(1, votes.length));
 }, 0) / Math.max(1, voterAgents.length),
 totalVotes: voterAgents.reduce((sum, a) => sum + a.getHistoricalActions('vote').length, 0)
 } : undefined;

 const marketTrend = tradingAgents.length > 0 ? {
 buyRatio: tradingAgents.reduce((sum, a) => {
 const trades = a.getHistoricalActions('trade');
 return sum + (trades.filter(t => t === 'buy').length / Math.max(1, trades.length));
 }, 0) / Math.max(1, tradingAgents.length),
 totalTrades: tradingAgents.reduce((sum, a) => sum + a.getHistoricalActions('trade').length, 0)
 } : undefined;

 const governanceApproval = governanceAgents.length > 0 ? {
 approvalRatio: governanceAgents.reduce((sum, a) => {
 const decisions = a.getHistoricalActions('decision');
 return sum + (decisions.filter(d => d === 'approve').length / Math.max(1, decisions.length));
 }, 0) / Math.max(1, governanceAgents.length),
 totalDecisions: governanceAgents.reduce((sum, a) => sum + a.getHistoricalActions('decision').length, 0)
 } : undefined;

 return { votingConsensus , marketTrend, governanceApproval };
}

export async function runAgents(agents: AIAgent[], env: Record<string, any>, steps: number): Promise<void> {
 agents.sort((a, b) => b.priority - a.priority);
 const leader = await electLeader(agents);
 console.log(`Leader elected: Agent ${leader.id} (${leader.role})`);

 // New: Track emergent behavior trends over time
 const behaviorTrends: EmergentBehavior[] = [];

 for (let step = 0; step < steps; step++) {
 console.log(`\nStep ${step + 1}:`);
 for (const agent of agents) {
 // Fetch MCP context for context-aware decisions
 if (agent.role === 'trader') {
 await agent.fetchMCPContext(env.chain, 'market', { token: 'ETH' });
 } else if (agent.role === 'voter' || agent.role === 'governor') {
 await agent.fetchMCPContext(env.chain, 'votes', { range: { start: step - 10, end: step } });
 }

 const decision = await agent.decisionModel(agent, env);
 
 if (agent.role === 'voter') {
 const secureVote = callTEESecureFunction(String(decision));
 const txHash = await submitVoteToContract(secureVote, env.chain);
 agent.state.vote = decision;
 agent.recordAction(step, decision, txHash !== '0x0' ? 'success' : 'failure');
 console.log(`Agent ${agent.id} (voter) voted: ${decision}, tx: ${txHash}`);
 } else if (agent.role === 'signer') {
 const signature = await signTransaction(env.transactions[agent.id % env.transactions.length]);
 const txHash = await submitTransaction(signature, env.chain);
 agent.state.txHash = txHash;
 agent.recordAction(step, signature, txHash !== '0x0' ? 'success' : 'failure');
 console.log(`Agent ${agent.id} (signer) signed transaction: ${txHash}`);
 } else if (agent.role === 'trader') {
 const tradeAction = decision as string;
 const txHash = await submitTransaction(`trade_${tradeAction}`, env.chain);
 agent.state.txHash = txHash;
 agent.recordAction(step, tradeAction, txHash !== '0x0' ? 'success' : 'failure');
 console.log(`Agent ${agent.id} (trader) performed trade: ${tradeAction}, tx: ${txHash}`);
 } else if (agent.role === 'governor') {
 const decisionAction = decision as string;
 const txHash = await submitVoteToContract(decisionAction, env.chain);
 agent.state.decision = decisionAction;
 agent.recordAction(step, decisionAction, txHash !== '0x0' ? 'success' : 'failure');
 console.log(`Agent ${agent.id} (governor) made decision: ${decisionAction}, tx: ${txHash}`);
 }

 const message = `${agent.role}:${agent.state.vote || agent.state.txHash || agent.state.decision}`;
 await sendMessage(agent, env, message);
 }

 const emergentBehavior = await analyzeEmergentBehavior(agents);
 behaviorTrends.push(emergentBehavior);
 console.log('Emergent Behavior:', emergentBehavior);
 }

 // New: Log emergent behavior trends
 console.log('\nEmergent Behavior Trends:');
 behaviorTrends.forEach((trend, index) => {
 console.log(`Step ${index + 1}:`, trend);
 });
}
