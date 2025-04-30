import { logger } from '../tools/logger';
import { callTEESecureFunction, generateZKProof } from '../tools/tee';

// Message types for agent communication
export enum MessageType {
  StateUpdate = 'state_update',
  DecisionShare = 'decision_share',
  SwarmFeedback = 'swarm_feedback',
  ConsensusRequest = 'consensus_request',
  ConsensusResponse = 'consensus_response',
  Gossip = 'gossip',
  Alert = 'alert',
}

// Message structure
export interface AgentMessage {
  type: MessageType;
  senderId: number;
  receiverId: number | 'broadcast'; // Specific agent or broadcast to all
  payload: any;
  timestamp: number;
  signature?: string; // ZKP signature for authenticity
  priority: number; // 0 (low) to 10 (high)
}

// Communication statistics
interface CommStats {
  messagesSent: number;
  messagesReceived: number;
  broadcastCount: number;
  averageLatency: number;
  failedMessages: number;
}

// Rate limiter for messages
interface RateLimiter {
  messages: number[];
  limit: number;
  windowMs: number;
}

export class AgentCommProtocol {
  private messageQueue: AgentMessage[];
  private stats: CommStats;
  private rateLimiter: RateLimiter;
  private messageListeners: Map<MessageType, Array<(msg: AgentMessage) => Promise<void>>>;

  constructor() {
    this.messageQueue = [];
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      broadcastCount: 0,
      averageLatency: 0,
      failedMessages: 0,
    };
    this.rateLimiter = {
      messages: [],
      limit: 1000, // 1000 messages per minute
      windowMs: 60 * 1000,
    };
    this.messageListeners = new Map();
    logger.info('AgentCommProtocol initialized');
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    this.rateLimiter.messages = this.rateLimiter.messages.filter(ts => now - ts < this.rateLimiter.windowMs);
    if (this.rateLimiter.messages.length >= this.rateLimiter.limit) {
      logger.warn('Communication rate limit exceeded');
      return false;
    }
    this.rateLimiter.messages.push(now);
    return true;
  }

  async sendMessage(message: AgentMessage): Promise<void> {
    try {
      if (!this.checkRateLimit()) {
        throw new Error('Rate limit exceeded');
      }

      // Secure the message with TEE and ZKP
      const payloadStr = JSON.stringify(message.payload);
      message.signature = await generateZKProof(payloadStr);
      const securePayload = callTEESecureFunction(payloadStr);
      message.payload = JSON.parse(securePayload);

      // Update stats
      this.stats.messagesSent++;
      if (message.receiverId === 'broadcast') {
        this.stats.broadcastCount++;
      }

      // Add to queue
      this.messageQueue.push(message);
      logger.debug(`Agent ${message.senderId} sent ${message.type} to ${message.receiverId}`);
    } catch (error) {
      this.stats.failedMessages++;
      logger.error(`Agent ${message.senderId} failed to send ${message.type}: ${error.message}`);
    }
  }

  async receiveMessages(agentId: number): Promise<AgentMessage[]> {
    try {
      const messages = this.messageQueue.filter(
        msg => msg.receiverId === agentId || msg.receiverId === 'broadcast'
      );
      this.messageQueue = this.messageQueue.filter(
        msg => msg.receiverId !== agentId && msg.receiverId !== 'broadcast'
      );

      // Update stats
      const startTime = Date.now();
      this.stats.messagesReceived += messages.length;
      const latency = Date.now() - startTime;
      this.stats.averageLatency = (this.stats.averageLatency * (this.stats.messagesReceived - messages.length) + latency) / this.stats.messagesReceived;

      messages.forEach(msg => {
        logger.debug(`Agent ${agentId} received ${msg.type} from ${msg.senderId}`);
      });
      return messages;
    } catch (error) {
      logger.error(`Agent ${agentId} failed to receive messages: ${error.message}`);
      return [];
    }
  }

  async processMessages(agentId: number): Promise<void> {
    const messages = await this.receiveMessages(agentId);
    for (const msg of messages) {
      const listeners = this.messageListeners.get(msg.type) || [];
      for (const listener of listeners) {
        await listener(msg);
      }
    }
  }

  registerListener(type: MessageType, listener: (msg: AgentMessage) => Promise<void>): void {
    if (!this.messageListeners.has(type)) {
      this.messageListeners.set(type, []);
    }
    this.messageListeners.get(type)!.push(listener);
    logger.info(`Registered listener for ${type}`);
  }

  // Gossip protocol for decentralized communication
  async gossip(senderId: number, payload: any, agents: number[]): Promise<void> {
    try {
      const fanout = Math.min(3, agents.length); // Fanout of 3 agents
      const selectedAgents = agents.sort(() => Math.random() - 0.5).slice(0, fanout);
      for (const receiverId of selectedAgents) {
        if (receiverId !== senderId) {
          await this.sendMessage({
            type: MessageType.Gossip,
            senderId,
            receiverId,
            payload,
            timestamp: Date.now(),
            priority: 5,
          });
        }
      }
      logger.info(`Agent ${senderId} initiated gossip to ${selectedAgents.join(', ')}`);
    } catch (error) {
      logger.error(`Agent ${senderId} failed to gossip: ${error.message}`);
    }
  }

  getStats(): CommStats {
    return this.stats;
  }
}

export const commProtocol = new AgentCommProtocol();
