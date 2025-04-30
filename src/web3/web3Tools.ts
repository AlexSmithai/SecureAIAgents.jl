import Web3 from 'web3';
import { logger } from '../tools/logger';

// Supported chains
type SupportedChain = 'ethereum' | 'solana' | 'near';

// Web3 provider configuration
interface Web3ProviderConfig {
  chain: SupportedChain;
  rpcUrl: string;
}

// Web3 utility class
export class Web3Tools {
  private providers: Record<SupportedChain, Web3> = {
    ethereum: new Web3('https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID'),
    solana: new Web3('https://api.mainnet-beta.solana.com'),
    near: new Web3('https://rpc.mainnet.near.org'),
  };

  constructor(configs: Web3ProviderConfig[]) {
    configs.forEach(({ chain, rpcUrl }) => {
      this.providers[chain] = new Web3(rpcUrl);
      logger.info(`Initialized Web3 provider for ${chain} at ${rpcUrl}`);
    });
  }

  // Encode transaction data
  async encodeTransaction(
    chain: SupportedChain,
    to: string,
    value: string,
    data: string = ''
  ): Promise<string> {
    try {
      const web3 = this.providers[chain];
      if (!web3) throw new Error(`Unsupported chain: ${chain}`);

      const tx = { to, value: web3.utils.toWei(value, 'ether'), data };
      const encoded = web3.eth.abi.encodeParameters(['address', 'uint256', 'bytes'], [to, tx.value, tx.data]);
      logger.debug(`Encoded transaction for ${chain}: ${encoded}`);
      return encoded;
    } catch (error) {
      logger.error(`Failed to encode transaction for ${chain}: ${error.message}`);
      throw error;
    }
  }

  // Estimate gas for a transaction
  async estimateGas(
    chain: SupportedChain,
    from: string,
    to: string,
    value: string,
    data: string = ''
  ): Promise<number> {
    try {
      const web3 = this.providers[chain];
      if (!web3) throw new Error(`Unsupported chain: ${chain}`);

      const gas = await web3.eth.estimateGas({
        from,
        to,
        value: web3.utils.toWei(value, 'ether'),
        data,
      });
      logger.debug(`Estimated gas for ${chain} transaction: ${gas}`);
      return gas;
    } catch (error) {
      logger.error(`Failed to estimate gas for ${chain}: ${error.message}`);
      return 21000; // Default gas for simple transfers
    }
  }

  // Listen for events on a contract
  async listenForEvents(
    chain: SupportedChain,
    contractAddress: string,
    eventName: string,
    callback: (event: any) => void
  ): Promise<void> {
    try {
      const web3 = this.providers[chain];
      if (!web3) throw new Error(`Unsupported chain: ${chain}`);

      const contract = new web3.eth.Contract([], contractAddress);
      contract.events[eventName]()
        .on('data', (event: any) => {
          logger.info(`Event ${eventName} on ${chain} at ${contractAddress}: ${JSON.stringify(event)}`);
          callback(event);
        })
        .on('error', (error: Error) => {
          logger.error(`Event listener error for ${eventName} on ${chain}: ${error.message}`);
        });
    } catch (error) {
      logger.error(`Failed to set up event listener for ${chain}: ${error.message}`);
      throw error;
    }
  }

  // Convert value between units (e.g., wei to ether)
  convertUnits(chain: SupportedChain, value: string, fromUnit: string, toUnit: string): string {
    try {
      const web3 = this.providers[chain];
      if (!web3) throw new Error(`Unsupported chain: ${chain}`);

      const converted = web3.utils.fromWei(value, toUnit as any);
      logger.debug(`Converted ${value} from ${fromUnit} to ${toUnit}: ${converted}`);
      return converted;
    } catch (error) {
      logger.error(`Failed to convert units for ${chain}: ${error.message}`);
      return value;
    }
  }
}

export const web3Tools = new Web3Tools([
  { chain: 'ethereum', rpcUrl: 'https://mainnet.infura.io/v3/YOUR_INFURA_PROJECT_ID' },
  { chain: 'solana', rpcUrl: 'https://api.mainnet-beta.solana.com' },
  { chain: 'near', rpcUrl: 'https://rpc.mainnet.near.org' },
]);
