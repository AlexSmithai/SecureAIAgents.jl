import { AIAgent } from '../src/core/agent';
import { createVoterAgent } from '../src/agents/voterAgent';
import { AgentRole, ActionOutcome } from '../src/agents/types';
import { logger } from '../src/tools/logger';

// Mock environment
const mockEnv = {
  chain: 'ethereum',
  blockHeight: 100,
  transactions: [],
  step: 0,
};

// Mock agents array
const mockAgents: AIAgent[] = [];

describe('AIAgent', () => {
  let agent: AIAgent;

  beforeEach(() => {
    agent = createVoterAgent(1, 1, false);
  });

  test('should initialize with correct properties', () => {
    expect(agent.getId()).toBe(1);
    expect(agent.getRole()).toBe(AgentRole.Voter);
    expect(agent.getPriority()).toBe(1);
    expect(agent.getAgentStats().successRate).toBe(0);
  });

  test('should execute a step and record an action', async () => {
    const decision = await agent.step(mockEnv, mockAgents);
    expect(decision).toMatch(/vote_(approve|reject)/);
    const actions = agent['getHistoricalActions']('vote');
    expect(actions.length).toBe(1);
    expect(['vote_approve', 'vote_reject']).toContain(actions[0].split('_')[0] + '_' + actions[0].split('_')[1]);
  });

  test('should update stats after a successful action', async () => {
    await agent.step(mockEnv, mockAgents);
    const stats = agent.getAgentStats();
    expect(stats.actions).toBe(1);
    expect(stats.successRate).toBe(1); // First action is successful
  });

  test('should handle errors gracefully', async () => {
    // Simulate an error by passing an invalid environment
    const invalidEnv = { ...mockEnv, chain: undefined };
    const decision = await agent.step(invalidEnv as any, mockAgents);
    expect(decision).toBe('vote_reject');
    const stats = agent.getAgentStats();
    expect(stats.actions).toBe(1);
  });
});

describe('Agent Communication', () => {
  test('should send and receive messages', async () => {
    const agent1 = createVoterAgent(1, 1);
    const agent2 = createVoterAgent(2, 1);
    const agents = [agent1, agent2];

    // Simulate agent1 sending a message
    await require('../src/communication/protocol').commProtocol.sendMessage({
      type: 'StateUpdate',
      senderId: agent1.getId(),
      receiverId: agent2.getId(),
      payload: { data: 'test' },
      timestamp: Date.now(),
      priority: 5,
    });

    // Process messages for agent2
    await agent2.step(mockEnv, agents);
    const messages = agent2['receivedMessages'] || [];
    expect(messages.length).toBe(1);
    expect(messages[0].payload.data).toBe('test');
  });
});
