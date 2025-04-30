import { createVoterAgent, createTradingAgent } from '../agents';
import { createBlockchainEnv, runAgents } from '../web3/blockchain';

async function runABMWeb3Simulation() {
  const chain = 'ethereum';
  const agents = [
    createVoterAgent(0, 1, true), // Voter agent with neural network
    createVoterAgent(1, 1, true),
    createTradingAgent(2, 2),     // Trading agent
    createTradingAgent(3, 2),
  ];

  const env = await createBlockchainEnv(agents.length, chain);
  await runAgents(agents, env, 5);
}

runABMWeb3Simulation().catch(console.error);
