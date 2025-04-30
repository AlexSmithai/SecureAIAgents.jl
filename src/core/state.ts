import * as fs from 'fs/promises';
import { AIAgent } from './agent';
import { logger } from '../tools/logger';

// State serialization version
const STATE_VERSION = '1.0.0';

// Backup state before saving
interface StateBackup {
  timestamp: number;
  data: any;
}

export async function saveAgentState(agent: AIAgent, filepath: string): Promise<void> {
  try {
    const stateDict = {
      version: STATE_VERSION,
      id: agent.getId(),
      role: agent.getRole(),
      state: agent['state'],
      history: agent['nnModel'] ? agent['nnModel']['history'] : [],
      mcpContext: agent['mcpContext'],
      actionHistory: agent['actionHistory'],
      personality: agent['personality'],
    };

    // Create backup before saving
    const backup: StateBackup = { timestamp: Date.now(), data: stateDict };
    await fs.writeFile(`${filepath}.backup`, JSON.stringify(backup, null, 2));

    // Save state
    await fs.writeFile(filepath, JSON.stringify(stateDict, null, 2));
    logger.info(`Saved agent ${agent.getId()} state to ${filepath}`);
  } catch (error) {
    logger.error(`Failed to save agent ${agent.getId()} state: ${error.message}`);
    throw error;
  }
}

export async function loadAgentState(agent: AIAgent, filepath: string): Promise<void> {
  try {
    const data = await fs.readFile(filepath, 'utf8');
    const stateDict = JSON.parse(data);

    // Check version compatibility
    if (stateDict.version !== STATE_VERSION) {
      logger.warn(`State version mismatch for agent ${agent.getId()}: expected ${STATE_VERSION}, got ${stateDict.version}`);
    }

    agent['state'] = stateDict.state;
    if (agent['nnModel']) {
      agent['nnModel']['history'] = stateDict.history;
    }
    agent['mcpContext'] = stateDict.mcpContext || {};
    agent['actionHistory'] = stateDict.actionHistory || { vote: [], sign: [], read: [], trade: [], decision: [] };
    agent['personality'] = stateDict.personality || null;
    logger.info(`Loaded agent ${agent.getId()} state from ${filepath}`);
  } catch (error) {
    logger.warn(`State file ${filepath} not found for agent ${agent.getId()}: ${error.message}`);
  }
}

export async function restoreFromBackup(agent: AIAgent, filepath: string): Promise<void> {
  try {
    const backupData = await fs.readFile(`${filepath}.backup
