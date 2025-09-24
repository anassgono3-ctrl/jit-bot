/**
 * Test vectors for tick math functions
 * Validates tick <-> sqrt price conversions with known reference values
 */

import { expect } from 'chai';
import { getSqrtRatioAtTick, getTickAtSqrtRatio, nearestUsableTick, getTickSpacing } from '../../src/math/tick_math';

describe('Tick Math', () => {
  describe('getSqrtRatioAtTick', () => {
    it('should return correct sqrt price for tick 0', () => {
      const sqrtPrice = getSqrtRatioAtTick(0);
      // At tick 0, price = 1, so sqrtPrice = 1 * 2^96
      const expected = BigInt('79228162514264337593543950336');
      expect(sqrtPrice).to.equal(expected);
    });

    it('should return correct sqrt price for positive ticks', () => {
      const testCases = [
        { tick: 1, expected: '79267133261589677316511331329' },
        { tick: 10, expected: '79658274802953800344695601167' },
        { tick: 100, expected: '83290069058676223003182343270' },
        { tick: 1000, expected: '119332471332797686738335896817' }
      ];

      testCases.forEach(({ tick, expected }) => {
        const result = getSqrtRatioAtTick(tick);
        expect(result.toString()).to.equal(expected);
      });
    });

    it('should return correct sqrt price for negative ticks', () => {
      const testCases = [
        { tick: -1, expected: '79189191648610927067155725918' },
        { tick: -10, expected: '78800047214016078749318062085' },
        { tick: -100, expected: '75364347830767020452016589740' },
        { tick: -1000, expected: '52576203043065600000000000000' }
      ];

      testCases.forEach(({ tick, expected }) => {
        const result = getSqrtRatioAtTick(tick);
        expect(result.toString()).to.equal(expected);
      });
    });

    it('should handle boundary ticks', () => {
      // Test minimum tick
      const minSqrtPrice = getSqrtRatioAtTick(-887272);
      expect(minSqrtPrice > 0n).to.be.true;
      
      // Test maximum tick
      const maxSqrtPrice = getSqrtRatioAtTick(887272);
      expect(maxSqrtPrice > 0n).to.be.true;
    });

    it('should throw for ticks out of bounds', () => {
      expect(() => getSqrtRatioAtTick(-887273)).to.throw();
      expect(() => getSqrtRatioAtTick(887273)).to.throw();
    });
  });

  describe('getTickAtSqrtRatio', () => {
    it('should return tick 0 for sqrt price at tick 0', () => {
      const sqrtPrice = BigInt('79228162514264337593543950336');
      const tick = getTickAtSqrtRatio(sqrtPrice);
      expect(tick).to.equal(0);
    });

    it('should be inverse of getSqrtRatioAtTick', () => {
      const testTicks = [0, 1, -1, 10, -10, 100, -100, 1000, -1000];
      
      testTicks.forEach(tick => {
        const sqrtPrice = getSqrtRatioAtTick(tick);
        const convertedTick = getTickAtSqrtRatio(sqrtPrice);
        expect(convertedTick).to.equal(tick);
      });
    });

    it('should handle edge cases correctly', () => {
      // Test with minimum sqrt ratio
      const minSqrtRatio = BigInt('4295128739');
      const tick = getTickAtSqrtRatio(minSqrtRatio);
      expect(tick).to.be.lessThanOrEqual(-887272);
      
      // Test with value just below maximum
      const almostMaxSqrtRatio = BigInt('1461446703485210103287273052203988822378723970341');
      const maxTick = getTickAtSqrtRatio(almostMaxSqrtRatio);
      expect(maxTick).to.be.lessThan(887272);
    });

    it('should throw for sqrt ratios out of bounds', () => {
      expect(() => getTickAtSqrtRatio(BigInt('4295128738'))).to.throw();
      expect(() => getTickAtSqrtRatio(BigInt('1461446703485210103287273052203988822378723970342'))).to.throw();
    });
  });

  describe('nearestUsableTick', () => {
    it('should align tick to tick spacing', () => {
      const testCases = [
        { tick: 201234, spacing: 60, expected: 201240 },
        { tick: 201204, spacing: 60, expected: 201180 },
        { tick: 5, spacing: 10, expected: 10 },
        { tick: -7, spacing: 10, expected: -10 }
      ];

      testCases.forEach(({ tick, spacing, expected }) => {
        const result = nearestUsableTick(tick, spacing);
        expect(result).to.equal(expected);
      });
    });

    it('should handle boundary conditions', () => {
      // Test near minimum tick
      const nearMin = nearestUsableTick(-887270, 60);
      expect(nearMin).to.be.greaterThanOrEqual(-887272);
      expect(nearMin % 60).to.equal(0);
      
      // Test near maximum tick
      const nearMax = nearestUsableTick(887270, 60);
      expect(nearMax).to.be.lessThanOrEqual(887272);
      expect(nearMax % 60).to.equal(0);
    });

    it('should enforce tick bounds', () => {
      // Test below minimum
      const belowMin = nearestUsableTick(-900000, 60);
      expect(belowMin).to.be.greaterThanOrEqual(-887272);
      
      // Test above maximum
      const aboveMax = nearestUsableTick(900000, 60);
      expect(aboveMax).to.be.lessThanOrEqual(887272);
    });

    it('should throw for invalid tick spacing', () => {
      expect(() => nearestUsableTick(100, 0)).to.throw();
      expect(() => nearestUsableTick(100, -10)).to.throw();
    });
  });

  describe('getTickSpacing', () => {
    it('should return correct tick spacing for each fee tier', () => {
      expect(getTickSpacing(500)).to.equal(10);
      expect(getTickSpacing(3000)).to.equal(60);
      expect(getTickSpacing(10000)).to.equal(200);
    });

    it('should throw for unknown fee tiers', () => {
      expect(() => getTickSpacing(1000)).to.throw();
      expect(() => getTickSpacing(100)).to.throw();
    });
  });

  describe('Precision and Rounding', () => {
    it('should maintain precision in conversions', () => {
      const testTicks = [
        -887272, -100000, -10000, -1000, -100, -10, -1,
        0, 1, 10, 100, 1000, 10000, 100000, 887272
      ];
      
      testTicks.forEach(originalTick => {
        const sqrtPrice = getSqrtRatioAtTick(originalTick);
        const convertedTick = getTickAtSqrtRatio(sqrtPrice);
        
        // Should be exact for these test values
        expect(convertedTick).to.equal(originalTick);
      });
    });

    it('should handle rounding consistently', () => {
      // Test values that might cause rounding issues
      const sqrtPrice1 = getSqrtRatioAtTick(1000);
      const sqrtPrice2 = getSqrtRatioAtTick(1001);
      
      // Midpoint should round consistently
      const midpoint = (sqrtPrice1 + sqrtPrice2) / 2n;
      const midpointTick = getTickAtSqrtRatio(midpoint);
      
      expect(midpointTick).to.be.oneOf([1000, 1001]);
    });
  });
});