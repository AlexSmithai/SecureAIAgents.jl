import { ethers } from 'ethers';
import * as solanaWeb3 from '@solana/web3.js';
import * as nearApi from 'near-api-js';
import { logger } from '../tools/logger';

// Supported blockchain configurations
export interface BlockchainConfig {
  chain: 'ethereum' | 'solana' | 'near';
  providerUrl: string;
  privateKey?: string;
  gasLimit?: number;
  gasPriceMultiplier?: number;
}

// Transaction batch for optimization
interface TransactionBatch {
  transactions: Array<{ to: string; value: string; data?: string }>;
  chain: string;
  nonce?: number;
}

// State for cross-chain interactions
interface BlockchainState {
  lastBlockNumber: Record<string, number>;
  pendingTransactions: Record<string, TransactionBatch>;
  walletBalances: Record<string, number>;
}

// Simulated wallet for testing (in production, use real wallet integration)
class BlockchainWallet {
  private wallets: Record<string, ethers.Wallet | solanaWeb3.Keypair | nearApi.WalletConnection>;
  private configs: Record<string, BlockchainConfig>;

  constructor() {
    this.wallets = {};
    this.configs = {};
  }

  async initialize(config: BlockchainConfig): Promise<void> {
    try {
      this.configs[config.chain] = config;
      if (config.chain === 'ethereum') {
        const provider = new ethers.providers.JsonRpcProvider(config.providerUrl);
        this.wallets[config.chain] = config.privateKey
          ? new ethers.Wallet(config.privateKey, provider)
          : ethers.Wallet.createRandom().connect(provider);
        logger.info(`Initialized Ethereum wallet for ${config.providerUrl}`);
      } else if (config.chain === 'solana') {
        this.wallets[config.chain] = solanaWeb3.Keypair.generate();
        logger.info(`Initialized Solana wallet for ${config.providerUrl}`);
      } else if (config.chain === 'near') {
        const near = await nearApi.connect({
          networkId: 'testnet',
          nodeUrl: config.providerUrl,
          walletUrl: 'https://wallet.testnet.near.org',
        });
        this.wallets[config.chain] = new nearApi.WalletConnection(near, null);
        logger.info(`Initialized NEAR wallet for ${config.providerUrl}`);
      } else {
        throw new Error(`Unsupported chain: ${config.chain}`);
      }
    } catch (error) {
      logger.error(`Failed to initialize wallet for ${config.chain}: ${error.message}`);
      throw error;
    }
  }

  getWallet(chain: string): any {
    const wallet = this.wallets[chain];
    if (!wallet) throw new Error(`Wallet not initialized for ${chain}`);
    return wallet;
  }
}

// Main blockchain interaction class
export class BlockchainClient {
  private wallet: BlockchainWallet;
  private state: BlockchainState;

  constructor() {
    this.wallet = new BlockchainWallet();
    this.state = {
      lastBlockNumber: {},
      pendingTransactions: {},
      walletBalances: {},
    };
  }

  async initialize(config: BlockchainConfig): Promise<void> {
    await this.wallet.initialize(config);
    this.state.lastBlockNumber[config.chain] = 0;
    this.state.pendingTransactions[config.chain] = { transactions: [], chain: config.chain };
    await this.updateWalletBalance(config.chain);
  }

  async updateWalletBalance(chain: string): Promise<void> {
    try {
      if (chain === 'ethereum') {
        const wallet = this.wallet.getWallet(chain) as ethers.Wallet;
        const balance = await wallet.getBalance();
        this.state.walletBalances[chain] = parseFloat(ethers.utils.formatEther(balance));
      } else if (chain === 'solana') {
        const wallet = this.wallet.getWallet(chain) as solanaWeb3.Keypair;
        const connection = new solanaWeb3.Connection(this.configs[chain].providerUrl, 'confirmed');
        const balance = await connection.getBalance(wallet.publicKey);
        this.state.walletBalances[chain] = balance / solanaWeb3.LAMPORTS_PER_SOL;
      } else if (chain === 'near') {
        const wallet = this.wallet.getWallet(chain) as nearApi.WalletConnection;
        const account = await wallet.account();
        const balance = await account.getAccountBalance();
        this.state.walletBalances[chain] = parseFloat(balance.total) / 1e24;
      }
      logger.info(`Updated balance for ${chain}: ${this.state.walletBalances[chain]}`);
    } catch (error) {
      logger.error(`Failed to update balance for ${chain}: ${error.message}`);
    }
  }

  async readBlockchainData(chain: string): Promise<number> {
    try {
      if (chain === 'ethereum') {
        const wallet = this.wallet.getWallet(chain) as ethers.Wallet;
        const blockNumber = await wallet.provider.getBlockNumber();
        this.state.lastBlockNumber[chain] = blockNumber;
        return blockNumber;
      } else if (chain === 'solana') {
        const connection = new solanaWeb3.Connection(this.configs[chain].providerUrl, 'confirmed');
        const slot = await connection.getSlot();
        this.state.lastBlockNumber[chain] = slot;
        return slot;
      } else if (chain === 'near') {
        const wallet = this.wallet.getWallet(chain) as nearApi.WalletConnection;
        const account = await wallet.account();
        const blockHeight = (await account.connection.provider.status()).sync_info.latest_block_height;
        this.state.lastBlockNumber[chain] = blockHeight;
        return blockHeight;
      }
      throw new Error(`Unsupported chain for reading: ${chain}`);
    } catch (error) {
      logger.error(`Failed to read blockchain data for ${chain}: ${error.message}`);
      return 0;
    }
  }

  async signTransaction(txData: { to: string; value: string; data?: string }, chain: string): Promise<string> {
    try {
      if (chain === 'ethereum') {
        const wallet = this.wallet.getWallet(chain) as ethers.Wallet;
        const tx = {
          to: txData.to,
          value: ethers.utils.parseEther(txData.value),
          data: txData.data || '0x',
          gasLimit: this.configs[chain].gasLimit || 21000,
          gasPrice: (await wallet.provider.getGasPrice()).mul(this.configs[chain].gasPriceMultiplier || 1),
        };
        const signedTx = await wallet.signTransaction(tx);
        return signedTx;
      } else if (chain === 'solana') {
        const wallet = this.wallet.getWallet(chain) as solanaWeb3.Keypair;
        const connection = new solanaWeb3.Connection(this.configs[chain].providerUrl, 'confirmed');
        const transaction = new solanaWeb3.Transaction().add(
          solanaWeb3.SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: new solanaWeb3.PublicKey(txData.to),
            lamports: Math.round(parseFloat(txData.value) * solanaWeb3.LAMPORTS_PER_SOL),
          })
        );
        const signature = await solanaWeb3.sendAndConfirmTransaction(connection, transaction, [wallet]);
        return signature;
      } else if (chain === 'near') {
        const wallet = this.wallet.getWallet(chain) as nearApi.WalletConnection;
        const account = await wallet.account();
        const result = await account.sendMoney(txData.to, txData.value);
        return result.transaction.hash;
      }
      throw new Error(`Unsupported chain for signing: ${chain}`);
    } catch (error) {
      logger.error(`Failed to sign transaction on ${chain}: ${error.message}`);
      return '0x0';
    }
  }

  async submitTransaction(signedTx: string, chain: string): Promise<string> {
    try {
      if (chain === 'ethereum') {
        const wallet = this.wallet.getWallet(chain) as ethers.Wallet;
        const txResponse = await wallet.provider.sendTransaction(signedTx);
        const receipt = await txResponse.wait();
        return receipt.transactionHash;
      } else if (chain === 'solana') {
        return signedTx; // Already submitted in signTransaction for Solana
      } else if (chain === 'near') {
        return signedTx; // Already submitted in signTransaction for NEAR
      }
      throw new Error(`Unsupported chain for submitting: ${chain}`);
    } catch (error) {
      logger.error(`Failed to submit transaction on ${chain}: ${error.message}`);
      return '0x0';
    }
  }

  async submitVote(chain: string, vote: boolean): Promise<string> {
    try {
      const contractAddress = '0x123...'; // Simulated contract address
      const data = vote ? '0x01' : '0x00'; // Simulated voting data
      const txData = { to: contractAddress, value: '0', data };
      const signedTx = await this.signTransaction(txData, chain);
      return await this.submitTransaction(signedTx, chain);
    } catch (error) {
      logger.error(`Failed to submit vote on ${chain}: ${error.message}`);
      return '0x0';
    }
  }

  async executeTrade(chain: string, action: 'buy' | 'sell', token: string, amount: number): Promise<string> {
    try {
      const contractAddress = '0x456...'; // Simulated trading contract
      const data = action === 'buy' ? `0x01${token}${amount}` : `0x02${token}${amount}`; // Simulated trade data
      const txData = { to: contractAddress, value: '0', data };
      const signedTx = await this.signTransaction(txData, chain);
      return await this.submitTransaction(signedTx, chain);
    } catch (error) {
      logger.error(`Failed to execute trade on ${chain}: ${error.message}`);
      return '0x0';
    }
  }

  async batchTransactions(chain: string): Promise<string[]> {
    try {
      const batch = this.state.pendingTransactions[chain];
      if (!batch || batch.transactions.length === 0) return [];

      const txHashes: string[] = [];
      for (const tx of batch.transactions) {
        const signedTx = await this.signTransaction(tx, chain);
        const txHash = await this.submitTransaction(signedTx, chain);
        txHashes.push(txHash);
      }

      batch.transactions = []; // Clear batch after submission
      logger.info(`Submitted batch of ${txHashes.length} transactions on ${chain}`);
      return txHashes;
    } catch (error) {
      logger.error(`Failed to batch transactions on ${chain}: ${error.message}`);
      return [];
    }
  }

  getState(): BlockchainState {
    return this.state;
  }
}

export const blockchainClient = new BlockchainClient();
