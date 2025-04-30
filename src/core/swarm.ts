import { AIAgent } from './agent';
import { logger } from '../tools/logger';
import { commProtocol, MessageType } from '../communication/protocol';

// Emergent behavior metrics
interface EmergentBehavior {
  successRate: number;
  cooperationLevel: number;
  activityVariance: number;
  consensusAlignment: number;
}

export class Swarm {
  private id: string;
  private agents: AIAgent[];
  private behaviorHistory: EmergentBehavior[];

  constructor(id: string, agents: AIAgent[]) {
    this.id = id;
    this.agents = agents;
    this.behaviorHistory = [];
    logger.info(`Swarm ${this.id} initialized with ${agents.length} agents`);
  }

  async coordinate(env: Record<string, any>): Promise<void> {
    try {
      // Encourage cooperation by sharing swarm feedback
      const avgSuccessRate = this.agents.reduce((sum, agent) => {
        const stats = agent.getAgentStats();
        return sum + stats.successRate;
      }, 0) / (this.agents.length || 1);

      const cooperationLevel = this.agents.reduce((sum, agent) => {
        const messages = agent['receivedMessages'] || [];
        const feedbackMessages = messages.filter((msg: any) => msg.type === MessageType.SwarmFeedback);
        return sum + feedbackMessages.length;
      }, 0) / (this.agents.length || 1);

      // Broadcast swarm feedback to all agents
      await commProtocol.sendMessage({
        type: MessageType.SwarmFeedback,
        senderId: -1, // Swarm identifier
        receiverId: 'broadcast',
        payload: { cooperation: cooperationLevel, successRate: avgSuccessRate },
        timestamp: Date.now(),
        priority: 7,
      });

      // Analyze emergent behavior
      const behavior = this.analyzeEmergentBehavior();
      this.behaviorHistory.push(behavior);
      if (this.behaviorHistory.length > 100) {
        this.behaviorHistory.shift();
      }

      logger.info(`Swarm ${this.id} coordinated: ${JSON.stringify(behavior)}`);
    } catch (error) {
      logger.error(`Swarm ${this.id} failed to coordinate: ${error.message}`);
    }
  }

  analyzeEmergentBehavior(): EmergentBehavior {
    try {
      const successRates = this.agents.map(agent => agent.getAgentStats().successRate);
      const avgSuccessRate = successRates.reduce((sum, rate) => sum + rate, 0) / (successRates.length || 1);

      const cooperationLevel = this.agents.reduce((sum, agent) => {
        const messages = agent['receivedMessages'] || [];
        const feedbackMessages = messages.filter((msg: any) => msg.type === MessageType.SwarmFeedback);
        return sum + feedbackMessages.length;
      }, 0) / (this.agents.length || 1);

      const activities = this.agents.map(agent => agent.getAgentStats().actions);
      const avgActivity = activities.reduce((sum, act) => sum + act, 0) / (activities.length || 1);
      const activityVariance = activities.reduce((sum, act) => sum + Math.pow(act - avgActivity, 2), 0) / (activities.length || 1);

      const consensusActions = this.agents.flatMap(agent =>
        agent['getHistoricalActions']('decision').filter(action => action.includes('consensus'))
      );
      const consensusAlignment = consensusActions.length / (this.agents.length || 1);

      return {
        successRate: avgSuccessRate,
        cooperationLevel,
        activityVariance,
        consensusAlignment,
      };
    } catch (error) {
      logger.error(`Swarm ${this.id} failed to analyze emergent behavior: ${error.message}`);
      return { successRate: 0, cooperationLevel: 0, activityVariance: 0, consensusAlignment: 0 };
    }
  }

  getBehaviorHistory(): EmergentBehavior[] {
    return this.behaviorHistory;
  }

  getId(): string {
    return this.id;
  }

  getAgents(): AIAgent[] {
    return this.agents;
  }
}
