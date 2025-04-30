import { AIAgent } from '../core/agent';
import { Swarm } from '../core/swarm';
import { logger } from '../tools/logger';
import { commProtocol, MessageType } from '../communication/protocol';

// Engine performance metrics
interface EngineMetrics {
  stepsCompleted: number;
  averageStepTime: number;
  agentActivity: Record<number, number>;
  swarmActivity: Record<string, number>;
  communicationVolume: number;
  consensusEvents: number;
}

// Environment configuration
interface EnvironmentConfig {
  chain: string;
  blockHeight: number;
  proposalId: string;
  contractAddress: string;
  transactions: Array<{ to: string; value: string; data?: string }>;
  step: number;
  simulationMode: 'real-time' | 'batch';
}

export class AgentEngine {
  private agents: AIAgent[];
  private swarms: Swarm[];
  private metrics: EngineMetrics;
  private config: EnvironmentConfig;
  private running: boolean;
  private stepInterval: NodeJS.Timeout | null;

  constructor(agents: AIAgent[], swarms: Swarm[], config: EnvironmentConfig) {
    this.agents = agents;
    this.swarms = swarms;
    this.config = config;
    this.metrics = {
      stepsCompleted: 0,
      averageStepTime: 0,
      agentActivity: {},
      swarmActivity: {},
      communicationVolume: 0,
      consensusEvents: 0,
    };
    this.running = false;
    this.stepInterval = null;
    logger.info('AgentEngine initialized with simulation mode:', config.simulationMode);
  }

  async run(steps: number): Promise<void> {
    try {
      this.running = true;
      for (let i = 0; i < steps && this.running; i++) {
        const startTime = Date.now();
        this.config.step = i;

        // Update environment dynamically
        this.config.blockHeight += 1;
        this.config.transactions = Array(5).fill({ to: '0x123...', value: '0.1' }).map((tx, idx) => ({
          to: `0x${idx}123...`,
          value: (Math.random() * 0.5).toFixed(4),
          data: Math.random() > 0.5 ? '0xabcdef' : undefined,
        }));

        // Process agent communications
        await Promise.all(this.agents.map(agent => commProtocol.processMessages(agent.getId())));

        // Run swarms in parallel
        const swarmPromises = this.swarms.map(async (swarm, idx) => {
          await swarm.coordinate(this.config);
          const behavior = swarm.analyzeEmergentBehavior();
          this.metrics.swarmActivity[`swarm_${idx}`] = behavior.successRate;
          logger.info(`Swarm ${idx} behavior: ${JSON.stringify(behavior)}`);
        });
        await Promise.all(swarmPromises);

        // Run agents in parallel based on priority
        const agentGroups = this.agents.reduce((groups, agent) => {
          const priority = agent.getPriority();
          groups[priority] = groups[priority] || [];
          groups[priority].push(agent);
          return groups;
        }, {} as Record<number, AIAgent[]>);

        for (const priority of Object.keys(agentGroups).sort((a, b) => Number(b) - Number(a))) {
          const agents = agentGroups[priority];
          const agentPromises = agents.map(async agent => {
            await agent.step(this.config, this.agents);
            // Share decisions with other agents
            const decision = agent['getHistoricalActions']('decision').slice(-1)[0];
            if (decision) {
              await commProtocol.sendMessage({
                type: MessageType.DecisionShare,
                senderId: agent.getId(),
                receiverId: 'broadcast',
                payload: { decision, role: agent.getRole() },
                timestamp: Date.now(),
                priority: agent.getPriority(),
              });
            }
          });
          await Promise.all(agentPromises);
        }

        // Update metrics
        this.updateMetrics(startTime);
      }
      logger.info('Simulation completed:', this.metrics);
    } catch (error) {
      logger.error('AgentEngine run failed:', error.message);
      throw error;
    } finally {
      this.running = false;
    }
  }

  async startRealTimeSimulation(intervalMs: number): Promise<void> {
    if (this.config.simulationMode !== 'real-time') {
      throw new Error('Simulation mode must be real-time for continuous execution');
    }
    this.running = true;
    this.stepInterval = setInterval(async () => {
      if (!this.running) {
        clearInterval(this.stepInterval!);
        return;
      }
      await this.run(1);
    }, intervalMs);
    logger.info(`Started real-time simulation with interval ${intervalMs}ms`);
  }

  stop(): void {
    this.running = false;
    if (this.stepInterval) {
      clearInterval(this.stepInterval);
      this.stepInterval = null;
    }
    logger.info('AgentEngine stopped');
  }

  private updateMetrics(startTime: number): void {
    try {
      const stepTime = Date.now() - startTime;
      this.metrics.stepsCompleted++;
      this.metrics.averageStepTime = (this.metrics.averageStepTime * (this.metrics.stepsCompleted - 1) + stepTime) / this.metrics.stepsCompleted;

      // Update agent activity metrics
      this.agents.forEach(agent => {
        const actions = agent['getHistoricalActions']('vote').length +
                        agent['getHistoricalActions']('trade').length +
                        agent['getHistoricalActions']('decision').length +
                        agent['getHistoricalActions']('read').length +
                        agent['getHistoricalActions']('sign').length;
        this.metrics.agentActivity[agent.getId()] = actions;
      });

      // Update communication volume
      this.metrics.communicationVolume = commProtocol.getStats().messagesSent;

      // Track consensus events
      const consensusMessages = this.agents.flatMap(agent =>
        agent['getHistoricalActions']('decision').filter(action => action.includes('consensus'))
      );
      this.metrics.consensusEvents = consensusMessages.length;

      logger.debug('Engine metrics updated:', this.metrics);
    } catch (error) {
      logger.error('Failed to update engine metrics:', error.message);
    }
  }

  getMetrics(): EngineMetrics {
    return this.metrics;
  }
}
