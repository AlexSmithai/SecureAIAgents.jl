import { AIAgent } from '../core/agent';
import { logger } from '../tools/logger';

// Game-theoretic payoff matrix
interface PayoffMatrix {
  cooperate: { cooperate: [number, number]; defect: [number, number] };
  defect: { cooperate: [number, number]; defect: [number, number] };
}

// Predictive model using Markov chains
interface MarkovModel {
  transitionMatrix: number[][]; // [state][nextState]
  currentState: number;
}

export const gameTheoreticDecision = async (agent: AIAgent, env: Record<string, any>, agents: AIAgent[]): Promise<number> => {
  try {
    const payoffMatrix: PayoffMatrix = {
      cooperate: { cooperate: [0.7, 0.7], defect: [0.2, 0.9] },
      defect: { cooperate: [0.9, 0.2], defect: [0.4, 0.4] },
    };

    const peers = agents.filter(a => a.getId() !== agent.getId());
    const cooperationScore = peers.reduce((score, peer) => {
      const peerAction = peer['getHistoricalActions']('decision').slice(-1)[0] || 'defect';
      const myAction = Math.random() > 0.5 ? 'cooperate' : 'defect';
      return score + payoffMatrix[myAction][peerAction][0];
    }, 0) / (peers.length || 1);

    logger.debug(`Agent ${agent.getId()} computed cooperation score: ${cooperationScore}`);
    return cooperationScore;
  } catch (error) {
    logger.error(`Agent ${agent.getId()} failed to compute game-theoretic decision: ${error.message}`);
    return 0.5;
  }
};

export const predictiveMarkovDecision = async (agent: AIAgent, env: Record<string, any>): Promise<number> => {
  try {
    const markov: MarkovModel = (agent['state'].markovState || {
      transitionMatrix: [[0.7, 0.3], [0.4, 0.6]],
      currentState: 0,
    }) as MarkovModel;

    // Update transition matrix based on historical actions
    const actions = agent['getHistoricalActions']('decision');
    if (actions.length > 1) {
      const transitions = actions.map(a => (a.includes('approve') || a.includes('success') ? 1 : 0));
      const counts = [[0, 0], [0, 0]];
      for (let i = 0; i < transitions.length - 1; i++) {
        counts[transitions[i]][transitions[i + 1]]++;
      }
      const totalFrom0 = counts[0][0] + counts[0][1];
      const totalFrom1 = counts[1][0] + counts[1][1];
      markov.transitionMatrix = [
        [totalFrom0 > 0 ? counts[0][0] / totalFrom0 : 0.7, totalFrom0 > 0 ? counts[0][1] / totalFrom0 : 0.3],
        [totalFrom1 > 0 ? counts[1][0] / totalFrom1 : 0.4, totalFrom1 > 0 ? counts[1][1] / totalFrom1 : 0.6],
      ];
    }

    // Predict next state
    const probs = markov.transitionMatrix[markov.currentState];
    markov.currentState = Math.random() < probs[0] ? 0 : 1;
    agent['state'].markovState = markov;

    logger.debug(`Agent ${agent.getId()} predicted next state: ${markov.currentState}`);
    return markov.currentState;
  } catch (error) {
    logger.error(`Agent ${agent.getId()} failed to compute Markov decision: ${error.message}`);
    return 0;
  }
};
