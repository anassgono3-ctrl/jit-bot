/**
 * Gas estimation and price utilities
 */

import type { Provider } from 'ethers';
import { formatUnits, parseUnits } from 'ethers';

/**
 * Get current gas price in gwei
 */
export async function getGasPriceGwei(provider: Provider): Promise<number> {
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice;
  
  if (!gasPrice) {
    throw new Error('Unable to fetch gas price');
  }
  
  return parseFloat(formatUnits(gasPrice, 'gwei'));
}

/**
 * Convert gwei to wei
 */
export function gweiToWei(gwei: number): bigint {
  return BigInt(parseUnits(gwei.toString(), 'gwei').toString());
}

/**
 * Convert wei to gwei
 */
export function weiToGwei(wei: bigint): number {
  return parseFloat(formatUnits(wei, 'gwei'));
}