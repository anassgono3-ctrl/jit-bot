/**
 * Test vectors for liquidity math functions
 * Validates liquidity calculations with known reference outputs
 */

import { expect } from 'chai';
import {
  liquidityFromToken0,
  liquidityFromToken1,
  liquidityForAmounts,
  getAmountsForLiquidity,
  getAmount0ForLiquidity,
  getAmount1ForLiquidity,
  calculateLiquidityForTicks
} from '../../src/math/liquidity_math';
import { getSqrtRatioAtTick } from '../../src/math/tick_math';

describe('Liquidity Math', () => {
  // Test constants
  const sqrtPriceX96_1 = getSqrtRatioAtTick(0); // price = 1
  const sqrtPriceX96_2 = getSqrtRatioAtTick(60); // price ≈ 1.0062
  const sqrtPriceX96_4 = getSqrtRatioAtTick(120); // price ≈ 1.0124

  describe('liquidityFromToken0', () => {
    it('should calculate liquidity from token0 amount correctly', () => {
      const amount0 = BigInt('1000000000000000000'); // 1 token with 18 decimals
      const liquidity = liquidityFromToken0(sqrtPriceX96_1, sqrtPriceX96_2, amount0);
      
      expect(liquidity > 0n).to.be.true;
      
      // Liquidity should be inversely related to price range width
      const narrowLiquidity = liquidityFromToken0(sqrtPriceX96_1, getSqrtRatioAtTick(30), amount0);
      expect(narrowLiquidity > liquidity).to.be.true;
    });

    it('should handle price order correctly', () => {
      const amount0 = BigInt('1000000000000000000');
      
      // Test with prices in different orders
      const liquidity1 = liquidityFromToken0(sqrtPriceX96_1, sqrtPriceX96_2, amount0);
      const liquidity2 = liquidityFromToken0(sqrtPriceX96_2, sqrtPriceX96_1, amount0);
      
      expect(liquidity1).to.equal(liquidity2);
    });

    it('should return zero for zero amount', () => {
      const liquidity = liquidityFromToken0(sqrtPriceX96_1, sqrtPriceX96_2, 0n);
      expect(liquidity).to.equal(0n);
    });
  });

  describe('liquidityFromToken1', () => {
    it('should calculate liquidity from token1 amount correctly', () => {
      const amount1 = BigInt('1000000'); // 1 USDC (6 decimals)
      const liquidity = liquidityFromToken1(sqrtPriceX96_1, sqrtPriceX96_2, amount1);
      
      expect(liquidity > 0n).to.be.true;
      
      // Liquidity should be inversely related to price range width
      const narrowLiquidity = liquidityFromToken1(sqrtPriceX96_1, getSqrtRatioAtTick(30), amount1);
      expect(narrowLiquidity > liquidity).to.be.true;
    });

    it('should handle price order correctly', () => {
      const amount1 = BigInt('1000000');
      
      const liquidity1 = liquidityFromToken1(sqrtPriceX96_1, sqrtPriceX96_2, amount1);
      const liquidity2 = liquidityFromToken1(sqrtPriceX96_2, sqrtPriceX96_1, amount1);
      
      expect(liquidity1).to.equal(liquidity2);
    });
  });

  describe('liquidityForAmounts', () => {
    it('should use only token0 when current price is below range', () => {
      const currentPrice = getSqrtRatioAtTick(-60); // Below range
      const amount0 = BigInt('1000000000000000000');
      const amount1 = BigInt('1000000');
      
      const liquidity = liquidityForAmounts(
        currentPrice,
        sqrtPriceX96_1,
        sqrtPriceX96_2,
        amount0,
        amount1
      );
      
      // Should equal liquidity calculated from token0 only
      const expectedLiquidity = liquidityFromToken0(sqrtPriceX96_1, sqrtPriceX96_2, amount0);
      expect(liquidity).to.equal(expectedLiquidity);
    });

    it('should use only token1 when current price is above range', () => {
      const currentPrice = getSqrtRatioAtTick(180); // Above range
      const amount0 = BigInt('1000000000000000000');
      const amount1 = BigInt('1000000');
      
      const liquidity = liquidityForAmounts(
        currentPrice,
        sqrtPriceX96_1,
        sqrtPriceX96_2,
        amount0,
        amount1
      );
      
      // Should equal liquidity calculated from token1 only
      const expectedLiquidity = liquidityFromToken1(sqrtPriceX96_1, sqrtPriceX96_2, amount1);
      expect(liquidity).to.equal(expectedLiquidity);
    });

    it('should use both tokens when current price is in range', () => {
      const currentPrice = getSqrtRatioAtTick(30); // In range between 0 and 60
      const amount0 = BigInt('1000000000000000000');
      const amount1 = BigInt('1000000');
      
      const liquidity = liquidityForAmounts(
        currentPrice,
        sqrtPriceX96_1,
        sqrtPriceX96_2,
        amount0,
        amount1
      );
      
      expect(liquidity > 0n).to.be.true;
      
      // Should be limited by the more constraining token
      const liquidity0 = liquidityFromToken0(currentPrice, sqrtPriceX96_2, amount0);
      const liquidity1 = liquidityFromToken1(sqrtPriceX96_1, currentPrice, amount1);
      
      expect(liquidity).to.equal(liquidity0 < liquidity1 ? liquidity0 : liquidity1);
    });
  });

  describe('getAmountsForLiquidity', () => {
    const testLiquidity = BigInt('1000000000000000');

    it('should return only token0 when current price is below range', () => {
      const currentPrice = getSqrtRatioAtTick(-60);
      
      const { amount0, amount1 } = getAmountsForLiquidity(
        currentPrice,
        sqrtPriceX96_1,
        sqrtPriceX96_2,
        testLiquidity
      );
      
      expect(amount0 > 0n).to.be.true;
      expect(amount1).to.equal(0n);
    });

    it('should return only token1 when current price is above range', () => {
      const currentPrice = getSqrtRatioAtTick(180);
      
      const { amount0, amount1 } = getAmountsForLiquidity(
        currentPrice,
        sqrtPriceX96_1,
        sqrtPriceX96_2,
        testLiquidity
      );
      
      expect(amount0).to.equal(0n);
      expect(amount1 > 0n).to.be.true;
    });

    it('should return both tokens when current price is in range', () => {
      const currentPrice = getSqrtRatioAtTick(30);
      
      const { amount0, amount1 } = getAmountsForLiquidity(
        currentPrice,
        sqrtPriceX96_1,
        sqrtPriceX96_2,
        testLiquidity
      );
      
      expect(amount0 > 0n).to.be.true;
      expect(amount1 > 0n).to.be.true;
    });
  });

  describe('getAmount0ForLiquidity', () => {
    it('should calculate token0 amount correctly', () => {
      const liquidity = BigInt('1000000000000000');
      const amount0 = getAmount0ForLiquidity(sqrtPriceX96_1, sqrtPriceX96_2, liquidity);
      
      expect(amount0 > 0n).to.be.true;
      
      // Wider range should require more token0
      const widerAmount0 = getAmount0ForLiquidity(sqrtPriceX96_1, sqrtPriceX96_4, liquidity);
      expect(widerAmount0 > amount0).to.be.true;
    });

    it('should handle price order correctly', () => {
      const liquidity = BigInt('1000000000000000');
      
      const amount1 = getAmount0ForLiquidity(sqrtPriceX96_1, sqrtPriceX96_2, liquidity);
      const amount2 = getAmount0ForLiquidity(sqrtPriceX96_2, sqrtPriceX96_1, liquidity);
      
      expect(amount1).to.equal(amount2);
    });
  });

  describe('getAmount1ForLiquidity', () => {
    it('should calculate token1 amount correctly', () => {
      const liquidity = BigInt('1000000000000000');
      const amount1 = getAmount1ForLiquidity(sqrtPriceX96_1, sqrtPriceX96_2, liquidity);
      
      expect(amount1 > 0n).to.be.true;
      
      // Wider range should require more token1
      const widerAmount1 = getAmount1ForLiquidity(sqrtPriceX96_1, sqrtPriceX96_4, liquidity);
      expect(widerAmount1 > amount1).to.be.true;
    });
  });

  describe('calculateLiquidityForTicks', () => {
    it('should calculate liquidity for tick range correctly', () => {
      const amount0 = BigInt('1000000000000000000');
      const amount1 = BigInt('1000000');
      
      const liquidity = calculateLiquidityForTicks(0, 60, 30, amount0, amount1);
      
      expect(liquidity > 0n).to.be.true;
    });

    it('should handle edge cases correctly', () => {
      const amount0 = BigInt('1000000000000000000');
      const amount1 = BigInt('1000000');
      
      // Current tick below range
      const liquidityBelow = calculateLiquidityForTicks(60, 120, 0, amount0, amount1);
      expect(liquidityBelow > 0n).to.be.true;
      
      // Current tick above range
      const liquidityAbove = calculateLiquidityForTicks(0, 60, 120, amount0, amount1);
      expect(liquidityAbove > 0n).to.be.true;
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle zero liquidity', () => {
      const { amount0, amount1 } = getAmountsForLiquidity(
        sqrtPriceX96_1,
        sqrtPriceX96_1,
        sqrtPriceX96_2,
        0n
      );
      
      expect(amount0).to.equal(0n);
      expect(amount1).to.equal(0n);
    });

    it('should handle very large amounts', () => {
      const largeAmount = BigInt('1000000000000000000000000'); // 1M tokens
      const liquidity = liquidityFromToken0(sqrtPriceX96_1, sqrtPriceX96_2, largeAmount);
      
      expect(liquidity > 0n).to.be.true;
      expect(liquidity < (BigInt(2) ** 128n)).to.be.true; // Should not overflow
    });

    it('should handle very small amounts', () => {
      const smallAmount = 1n;
      const liquidity = liquidityFromToken0(sqrtPriceX96_1, sqrtPriceX96_2, smallAmount);
      
      expect(liquidity >= 0n).to.be.true;
    });
  });
});