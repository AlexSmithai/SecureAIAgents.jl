import * as tf from '@tensorflow/tfjs';
import { logger } from '../tools/logger';
import { AIAgent, NeuralNetModel } from '../core/agent';

// RL environment state
interface RLEnvironmentState {
  features: number[];
  reward: number;
  done: boolean;
}

// RL configuration
interface RLConfig {
  learningRate: number;
  discountFactor: number;
  explorationRate: number;
  explorationDecay: number;
  batchSize: number;
  memorySize: number;
}

// Experience replay memory
interface Experience {
  state: number[];
  action: number;
  reward: number;
  nextState: number[];
  done: boolean;
}

export class RLEngine {
  private config: RLConfig;
  private memory: Experience[];
  private model: NeuralNetModel;

  constructor(config: Partial<RLConfig> = {}) {
    this.config = {
      learningRate: config.learningRate || 0.001,
      discountFactor: config.discountFactor || 0.95,
      explorationRate: config.explorationRate || 1.0,
      explorationDecay: config.explorationDecay || 0.995,
      batchSize: config.batchSize || 32,
      memorySize: config.memorySize || 1000,
    };
    this.memory = [];

    // Initialize a simple neural network model
    this.model = tf.sequential();
    this.model.add(tf.layers.dense({ units: 24, inputShape: [5], activation: 'relu' }));
    this.model.add(tf.layers.dense({ units: 24, activation: 'relu' }));
    this.model.add(tf.layers.dense({ units: 2, activation: 'softmax' }));
    this.model.compile({
      optimizer: tf.train.adam(this.config.learningRate),
      loss: 'categoricalCrossentropy',
    });

    logger.info(`RLEngine initialized with config: ${JSON.stringify(this.config)}`);
  }

  async train(agent: AIAgent, envState: RLEnvironmentState): Promise<void> {
    try {
      const state = envState.features;
      const reward = envState.reward;
      const done = envState.done;

      // Predict action (explore or exploit)
      const action = Math.random() < this.config.explorationRate ? Math.floor(Math.random() * 2) : this.chooseAction(state);
      const nextState = envState.features; // Simplified; in reality, this would come from the environment

      // Store experience in memory
      this.memory.push({ state, action, reward, nextState, done });
      if (this.memory.length > this.config.memorySize) {
        this.memory.shift();
      }

      // Sample a batch and train
      if (this.memory.length >= this.config.batchSize) {
        const batch = this.sampleBatch(this.config.batchSize);
        const states = batch.map(exp => exp.state);
        const nextStates = batch.map(exp => exp.nextState);
        const rewards = batch.map(exp => exp.reward);
        const actions = batch.map(exp => exp.action);
        const dones = batch.map(exp => exp.done);

        const qValues = tf.tidy(() => {
          const stateTensor = tf.tensor2d(states);
          const nextStateTensor = tf.tensor2d(nextStates);
          const currentQ = this.model.predict(stateTensor) as tf.Tensor;
          const nextQ = this.model.predict(nextStateTensor) as tf.Tensor;

          const targetQ = currentQ.dataSync().slice();
          for (let i = 0; i < batch.length; i++) {
            const actionIdx = actions[i];
            const reward = rewards[i];
            const done = dones[i];
            const nextQMax = Math.max(...nextQ.dataSync().slice(i * 2, (i + 1) * 2));
            targetQ[i * 2 + actionIdx] = reward + (done ? 0 : this.config.discountFactor * nextQMax);
          }

          return tf.tensor2d(targetQ, [batch.length, 2]);
        });

        await this.model.fit(tf.tensor2d(states), qValues, { epochs: 1, verbose: 0 });
        qValues.dispose();

        // Update agent's neural network
        agent['nnModel'] = this.model;
      }

      // Decay exploration rate
      this.config.explorationRate *= this.config.explorationDecay;
      this.config.explorationRate = Math.max(0.1, this.config.explorationRate);

      logger.debug(`RLEngine trained agent ${agent.getId()}: exploration rate = ${this.config.explorationRate}`);
    } catch (error) {
      logger.error(`RLEngine failed to train agent ${agent.getId()}: ${error.message}`);
    }
  }

  private chooseAction(state: number[]): number {
    const stateTensor = tf.tensor2d([state]);
    const prediction = this.model.predict(stateTensor) as tf.Tensor;
    const action = prediction.argMax(-1).dataSync()[0];
    stateTensor.dispose();
    prediction.dispose();
    return action;
  }

  private sampleBatch(batchSize: number): Experience[] {
    const indices = Array.from({ length: batchSize }, () => Math.floor(Math.random() * this.memory.length));
    return indices.map(i => this.memory[i]);
  }

  getModel(): NeuralNetModel {
    return this.model;
  }
}
