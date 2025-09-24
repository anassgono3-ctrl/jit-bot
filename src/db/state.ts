/**
 * Lightweight JSON-based state persistence store
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import type { BotState } from '../types/index.js';
import { logger } from '../utils/logger.js';

/**
 * JSON state store for lightweight persistence
 */
export class StateStore {
  private state: BotState;
  private readonly filePath: string;

  constructor(filePath: string = './data/state.json') {
    this.filePath = filePath;
    this.state = {
      lastProcessedBlock: 0,
      opportunityCount: 0,
      startTime: Date.now(),
    };
  }

  /**
   * Load state from file
   */
  async load(): Promise<void> {
    try {
      if (existsSync(this.filePath)) {
        const data = await readFile(this.filePath, 'utf8');
        this.state = JSON.parse(data) as BotState;
        logger.debug(`State loaded from file: ${this.filePath}`);
      } else {
        logger.debug('State file not found, using defaults');
      }
    } catch (error) {
      logger.warn(`Failed to load state, using defaults: ${String(error)}`);
    }
  }

  /**
   * Save state to file
   */
  async save(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      await writeFile(this.filePath, JSON.stringify(this.state, null, 2));
      logger.debug(`State saved to file: ${this.filePath}`);
    } catch (error) {
      logger.error(`Failed to save state: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Get current state
   */
  getState(): BotState {
    return { ...this.state };
  }

  /**
   * Update last processed block
   */
  setLastProcessedBlock(blockNumber: number): void {
    this.state.lastProcessedBlock = blockNumber;
  }

  /**
   * Increment opportunity count
   */
  incrementOpportunityCount(): void {
    this.state.opportunityCount++;
  }

  /**
   * Reset state (useful for testing)
   */
  reset(): void {
    this.state = {
      lastProcessedBlock: 0,
      opportunityCount: 0,
      startTime: Date.now(),
    };
  }
}
