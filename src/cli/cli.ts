import { program } from 'commander';
import { AgentEngine } from '../engine/engine';
import { createVoterAgent, createSignerAgent, createReaderAgent, createTradingAgent, createGovernanceAgent } from '../agents';
import { Swarm } from '../core/swarm';
import { logger } from '../tools/logger';

program
  .command('simulate')
  .description('Run an ABM Web3 simulation')
  .option('-s, --steps <number>', 'Number of simulation steps', '10')
  .option('-r, --real-time', 'Run in real-time mode')
  .option('-i, --interval <number>', 'Real-time interval in milliseconds', '1000')
  .option('-a, --agents <number>', 'Number of agents', '5')
  .action(async (options) => {
    try {
      const steps = parseInt(options.steps, 10);
      const interval = parseInt(options.interval, 10);
      const agentCount = parseInt(options.agents, 10);

      // Initialize agents
      const agents = [
        createVoterAgent(1, 1),
        createSignerAgent(2, 2),
        createReaderAgent(3, 1),
        createTradingAgent(4, 3),
        createGovernanceAgent(5, 5),
      ].slice(0, agentCount);

      // Initialize swarms
      const swarms = [new Swarm('swarm_1', agents)];

      // Initialize engine
      const config = {
        chain: 'ethereum',
        blockHeight: 0,
        proposalId: '',
        contractAddress: '0x123...',
        transactions: [],
        step: 0,
        simulationMode: options.realTime ? 'real-time' : 'batch',
      };
      const engine = new AgentEngine(agents, swarms, config);

      // Run simulation
      if (options.realTime) {
        logger.info(`Starting real-time simulation with interval ${interval}ms...`);
        await engine.startRealTimeSimulation(interval);
      } else {
        logger.info(`Running simulation for ${steps} steps...`);
        await engine.run(steps);
      }

      logger.info('Simulation completed. Metrics:', engine.getMetrics());
    } catch (error) {
      logger.error(`CLI simulation failed: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('metrics')
  .description('Fetch simulation metrics')
  .action(async () => {
    try {
      // Note: This would typically fetch metrics from a running server or stored state
      logger.info('Fetching metrics (mock implementation)...');
      logger.info('Metrics: { stepsCompleted: 0, averageStepTime: 0, ... }');
    } catch (error) {
      logger.error(`CLI metrics fetch failed: ${error.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
