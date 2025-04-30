import express from 'express';
import { AIAgent } from '../core/agent';
import { analyzeEmergentBehavior } from '../engine/engine';

const app = express();
app.use(express.json());

let agents: AIAgent[] = [];
let env: Record<string, any> = {};

app.post('/agents', (req, res) => {
  const { id, role, priority, useNN } = req.body;
  const agent = new AIAgent(id, role, async (agent: AIAgent, env: Record<string, any>) => {
    // Simplified decision model for server
    return true;
  }, useNN || false, priority || 0);
  agents.push(agent);
  res.status(201).json({ message: `Agent ${id} created`, agent });
});

app.get('/agents/:id', (req, res) => {
  const agent = agents.find(a => a.id === parseInt(req.params.id));
  if (agent) {
    res.json(agent);
  } else {
    res.status(404).json({ message: 'Agent not found' });
  }
});

// New: Expose emergent behavior metrics
app.get('/emergent-behavior', async (req, res) => {
  const emergentBehavior = await analyzeEmergentBehavior(agents);
  res.json(emergentBehavior);
});

// New: Expose agent history
app.get('/agents/:id/history', (req, res) => {
  const agent = agents.find(a => a.id === parseInt(req.params.id));
  if (agent) {
    res.json(agent.actionHistory);
  } else {
    res.status(404).json({ message: 'Agent not found' });
  }
});

app.post('/run', async (req, res) => {
  const { steps } = req.body;
  await runAgents(agents, env, steps || 1);
  res.json({ message: `Ran ${steps} steps` });
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
