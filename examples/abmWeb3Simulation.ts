import { AgentEngine } from '../src/engine/engine';
import { createVoterAgent, createSignerAgent, createReaderAgent, createTradingAgent, createGovernanceAgent } from '../src/agents';
import { Swarm } from '../src/core/swarm';
import { logger } from '../src/tools/logger';

async function runABMWeb3Simulation() {
  try {
    // Initialize agents
    const agents = [
      createVoterAgent(1, 1, true),
      createSignerAgent(2, 2, true),
      createReaderAgent(3, 1),
      createTradingAgent(4, 3, true),
      createGovernanceAgent(5, 5, true),
    ];

    // Initialize swarms
    const swarms = [new Swarm('swarm_1', agents)];

    // Initialize environment
    const config = {
      chain: 'ethereum',
      blockHeight: 0,
      proposalId: 'prop_001',
      contractAddress: '0x123...',
      transactions: [],
      step: 0,
      simulationMode: 'batch' as 'real-time' | 'batch',
    };

    // Initialize engine
    const engine = new AgentEngine(agents, swarms, config);

    // Run simulation
    logger.info('Starting ABM Web3 simulation...');
    await engine.run(20);

    // Log metrics
    const metrics = engine.getMetrics();
    logger.info('Simulation completed. Metrics:', metrics);
  } catch (error) {
    logger.error(`ABM Web3 simulation failed: ${error.message}`);
  }
}

runABMWeb3Simulation();
