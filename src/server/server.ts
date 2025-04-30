import express from 'express';
import { AgentEngine } from '../engine/engine';
import { logger } from '../tools/logger';
import { commProtocol } from '../communication/protocol';

const app = express();
app.use(express.json());

interface ServerState {
  engine: AgentEngine | null;
  port: number;
  runningSimulations: number;
}

const serverState: ServerState = {
  engine: null,
  port: 3000,
  runningSimulations: 0,
};

app.post('/start
