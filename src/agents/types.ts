// Agent roles
export enum AgentRole {
  Voter = 'voter',
  Signer = 'signer',
  Reader = 'reader',
  Trader = 'trader',
  Governor = 'governor',
}

// Action outcomes
export enum ActionOutcome {
  Success = 'success',
  Failure = 'failure',
  Pending = 'pending',
}

// Agent state structure
export interface AgentState {
  key: string;
  vote: boolean | null;
  txHash: string | null;
  blockHeight: number;
  balance: number;
  portfolio: { assets: Record<string, number>; value: number };
  consensusState: any;
  markovState: any;
}

// Agent action history entry
export interface AgentAction {
  step: number;
  action: boolean | string;
  outcome: ActionOutcome;
  metadata: Record<string, any>;
}

// Decision model type
export type DecisionModel = (agent: any, env: Record<string, any>, agents: any[]) => Promise<boolean | string>;

// Plugin interface for extending agent behavior
export interface AgentPlugin {
  onStep?: (agent: any, env: Record<string, any>, agents: any[]) => Promise<void>;
  onDecision?: (agent: any, decision: boolean | string) => Promise<void>;
  onMessage?: (agent: any, message: any) => Promise<void>;
}

// Consensus request payload
export interface ConsensusRequest {
  proposalId: string;
  deadline: number;
  options: string[];
}

// Consensus response payload
export interface ConsensusResponse {
  proposalId: string;
  vote: string;
  confidence: number;
}

// Agent analytics
export interface AgentAnalytics {
  totalActions: number;
  successRate: number;
  communicationInfluence: Record<number, number>;
  decisionAccuracy: number;
}
