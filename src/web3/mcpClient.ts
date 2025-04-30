import { logger } from '../tools/logger';

// MCP response structure
export interface MCPResponse {
  data: any;
  timestamp: number;
  chain: string;
  type: string;
  params: any;
  validated: boolean;
}

// Cache for MCP responses to reduce redundant queries
interface MCPCache {
  [key: string]: MCPResponse;
}

// Rate limiter state
interface RateLimiter {
  requests: number[];
  limit: number;
  windowMs: number;
}

export class MCPClient {
  private cache: MCPCache;
  private rateLimiter: RateLimiter;

  constructor() {
    this.cache = {};
    this.rateLimiter = {
      requests: [],
      limit: 100, // 100 requests per window
      windowMs: 60 * 1000, // 1 minute window
    };
  }

  private checkRateLimit(): boolean {
    const now = Date.now();
    this.rateLimiter.requests = this.rateLimiter.requests.filter(ts => now - ts < this.rateLimiter.windowMs);
    if (this.rateLimiter.requests.length >= this.rateLimiter.limit) {
      logger.warn('MCP rate limit exceeded');
      return false;
    }
    this.rateLimiter.requests.push(now);
    return true;
  }

  private generateCacheKey(chain: string, type: string, params: any): string {
    return `${chain}:${type}:${JSON.stringify(params)}`;
  }

  private validateResponse(data: any, type: string): boolean {
    try {
      if (type === 'votes' || type === 'transactions') {
        return Array.isArray(data) && data.every(item => typeof item === 'boolean' || typeof item === 'string');
      } else if (type === 'market') {
        return data && typeof data.priceChange === 'number' && typeof data.volatility === 'number';
      } else if (type === 'proposals') {
        return Array.isArray(data) && data.every(item => typeof item === 'string');
      }
      return false;
    } catch (error) {
      logger.error(`Failed to validate MCP response for type ${type}: ${error.message}`);
      return false;
    }
  }

  async fetchHistoricalData(chain: string, type: 'votes' | 'transactions', params: any = {}): Promise<MCPResponse> {
    try {
      if (!this.checkRateLimit()) {
        throw new Error('Rate limit exceeded');
      }

      const cacheKey = this.generateCacheKey(chain, type, params);
      if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].timestamp < 5 * 60 * 1000) {
        logger.info(`Returning cached MCP data for ${cacheKey}`);
        return this.cache[cacheKey];
      }

      // Simulated MCP data fetch (replace with real API call)
      const data = type === 'votes' ? Array(10).fill(true).map((_, i) => i % 2 === 0) : Array(10).fill('tx_').map((_, i) => `tx_${i}`);
      const validated = this.validateResponse(data, type);
      if (!validated) {
        throw new Error(`Invalid MCP data for type ${type}`);
      }

      const response: MCPResponse = {
        data,
        timestamp: Date.now(),
        chain,
        type,
        params,
        validated,
      };
      this.cache[cacheKey] = response;
      logger.info(`Fetched MCP historical data for ${chain} (${type})`);
      return response;
    } catch (error) {
      logger.error(`Failed to fetch MCP historical data for ${chain} (${type}): ${error.message}`);
      throw error;
    }
  }

  async fetchMarketData(chain: string, token: string): Promise<MCPResponse> {
    try {
      if (!this.checkRateLimit()) {
        throw new Error('Rate limit exceeded');
      }

      const params = { token };
      const cacheKey = this.generateCacheKey(chain, 'market', params);
      if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].timestamp < 5 * 60 * 1000) {
        logger.info(`Returning cached MCP market data for ${cacheKey}`);
        return this.cache[cacheKey];
      }

      // Simulated market data fetch
      const data = { priceChange: Math.random() * 0.1 - 0.05, volatility: Math.random() * 0.05 };
      const validated = this.validateResponse(data, 'market');
      if (!validated) {
        throw new Error('Invalid MCP market data');
      }

      const response: MCPResponse = {
        data,
        timestamp: Date.now(),
        chain,
        type: 'market',
        params,
        validated,
      };
      this.cache[cacheKey] = response;
      logger.info(`Fetched MCP market data for ${chain} (${token})`);
      return response;
    } catch (error) {
      logger.error(`Failed to fetch MCP market data for ${chain} (${token}): ${error.message}`);
      throw error;
    }
  }

  async fetchGovernanceProposals(chain: string, contractAddress: string): Promise<MCPResponse> {
    try {
      if (!this.checkRateLimit()) {
        throw new Error('Rate limit exceeded');
      }

      const params = { contractAddress };
      const cacheKey = this.generateCacheKey(chain, 'proposals', params);
      if (this.cache[cacheKey] && Date.now() - this.cache[cacheKey].timestamp < 5 * 60 * 1000) {
        logger.info(`Returning cached MCP proposals for ${cacheKey}`);
        return this.cache[cacheKey];
      }

      // Simulated proposals fetch
      const data = Array(5).fill('proposal_').map((_, i) => `proposal_${i}`);
      const validated = this.validateResponse(data, 'proposals');
      if (!validated) {
        throw new Error('Invalid MCP proposals data');
      }

      const response: MCPResponse = {
        data,
        timestamp: Date.now(),
        chain,
        type: 'proposals',
        params,
        validated,
      };
      this.cache[cacheKey] = response;
      logger.info(`Fetched MCP governance proposals for ${chain} (${contractAddress})`);
      return response;
    } catch (error) {
      logger.error(`Failed to fetch MCP governance proposals for ${chain} (${contractAddress}): ${error.message}`);
      throw error;
    }
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: Object.keys(this.cache).length,
      keys: Object.keys(this.cache),
    };
  }
}

export const mcpClient = new MCPClient();
