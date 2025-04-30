import { runABMWeb3Simulation } from '../examples/abmWeb3Simulation';
import { logger } from './tools/logger';

async function main() {
  logger.info('Starting Sphinx framework...');
  try {
    await runABMWeb3Simulation();
    logger.info('Simulation completed successfully');
  } catch (error) {
    logger.error('Error in main:', error);
    process.exit(1);
  }
}

main();
