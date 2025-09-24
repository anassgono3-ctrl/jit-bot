/**
 * Uniswap V3 Tick Math Implementation
 * Deterministic, pure functions for tick <-> sqrt price conversions
 */

// Constants from Uniswap V3
const MIN_TICK = -887272;
const MAX_TICK = 887272;
const MIN_SQRT_RATIO = BigInt('4295128739');
const MAX_SQRT_RATIO = BigInt('1461446703485210103287273052203988822378723970342');

/**
 * Convert tick to sqrt price X96
 * @param tick The tick value
 * @returns The sqrt price as X96 format (BigInt)
 */
export function getSqrtRatioAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error(`Tick ${tick} out of bounds [${MIN_TICK}, ${MAX_TICK}]`);
  }

  const absTick = tick < 0 ? -tick : tick;
  
  // Use the most significant bit approach from Uniswap V3
  let ratio = (absTick & 0x1) !== 0 
    ? BigInt('0xfffcb933bd6fad37aa2d162d1a594001') 
    : BigInt('0x100000000000000000000000000000000');

  if ((absTick & 0x2) !== 0) ratio = (ratio * BigInt('0xfff97272373d413259a46990580e213a')) >> 128n;
  if ((absTick & 0x4) !== 0) ratio = (ratio * BigInt('0xfff2e50f5f656932ef12357cf3c7fdcc')) >> 128n;
  if ((absTick & 0x8) !== 0) ratio = (ratio * BigInt('0xffe5caca7e10e4e61c3624eaa0941cd0')) >> 128n;
  if ((absTick & 0x10) !== 0) ratio = (ratio * BigInt('0xffcb9843d60f6159c9db58835c926644')) >> 128n;
  if ((absTick & 0x20) !== 0) ratio = (ratio * BigInt('0xff973b41fa98c081472e6896dfb254c0')) >> 128n;
  if ((absTick & 0x40) !== 0) ratio = (ratio * BigInt('0xff2ea16466c96a3843ec78b326b52861')) >> 128n;
  if ((absTick & 0x80) !== 0) ratio = (ratio * BigInt('0xfe5dee046a99a2a811c461f1969c3053')) >> 128n;
  if ((absTick & 0x100) !== 0) ratio = (ratio * BigInt('0xfcbe86c7900a88aedcffc83b479aa3a4')) >> 128n;
  if ((absTick & 0x200) !== 0) ratio = (ratio * BigInt('0xf987a7253ac413176f2b074cf7815e54')) >> 128n;
  if ((absTick & 0x400) !== 0) ratio = (ratio * BigInt('0xf3392b0822b70005940c7a398e4b70f3')) >> 128n;
  if ((absTick & 0x800) !== 0) ratio = (ratio * BigInt('0xe7159475a2c29b7443b29c7fa6e889d9')) >> 128n;
  if ((absTick & 0x1000) !== 0) ratio = (ratio * BigInt('0xd097f3bdfd2022b8845ad8f792aa5825')) >> 128n;
  if ((absTick & 0x2000) !== 0) ratio = (ratio * BigInt('0xa9f746462d870fdf8a65dc1f90e061e5')) >> 128n;
  if ((absTick & 0x4000) !== 0) ratio = (ratio * BigInt('0x70d869a156d2a1b890bb3df62baf32f7')) >> 128n;
  if ((absTick & 0x8000) !== 0) ratio = (ratio * BigInt('0x31be135f97d08fd981231505542fcfa6')) >> 128n;
  if ((absTick & 0x10000) !== 0) ratio = (ratio * BigInt('0x9aa508b5b7a84e1c677de54f3e99bc9')) >> 128n;
  if ((absTick & 0x20000) !== 0) ratio = (ratio * BigInt('0x5d6af8dedb81196699c329225ee604')) >> 128n;
  if ((absTick & 0x40000) !== 0) ratio = (ratio * BigInt('0x2216e584f5fa1ea926041bedfe98')) >> 128n;
  if ((absTick & 0x80000) !== 0) ratio = (ratio * BigInt('0x48a170391f7dc42444e8fa2')) >> 128n;

  if (tick > 0) ratio = (BigInt(2) ** 256n - 1n) / ratio;

  return ratio >> 32n;
}

/**
 * Convert sqrt price X96 to tick
 * @param sqrtPriceX96 The sqrt price in X96 format
 * @returns The corresponding tick
 */
export function getTickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
    throw new Error(`SqrtPriceX96 ${sqrtPriceX96} out of bounds`);
  }

  const ratio = sqrtPriceX96 << 32n;
  
  let r = ratio;
  let msb = 0;

  // Find most significant bit
  let f = r > BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF') ? 1 << 7 : 0;
  msb = msb | f;
  r = r >> BigInt(f);

  f = r > BigInt('0xFFFFFFFFFFFFFFFF') ? 1 << 6 : 0;
  msb = msb | f;
  r = r >> BigInt(f);

  f = r > BigInt('0xFFFFFFFF') ? 1 << 5 : 0;
  msb = msb | f;
  r = r >> BigInt(f);

  f = r > BigInt('0xFFFF') ? 1 << 4 : 0;
  msb = msb | f;
  r = r >> BigInt(f);

  f = r > BigInt('0xFF') ? 1 << 3 : 0;
  msb = msb | f;
  r = r >> BigInt(f);

  f = r > BigInt('0xF') ? 1 << 2 : 0;
  msb = msb | f;
  r = r >> BigInt(f);

  f = r > BigInt('0x3') ? 1 << 1 : 0;
  msb = msb | f;
  r = r >> BigInt(f);

  f = r > BigInt('0x1') ? 1 : 0;
  msb = msb | f;

  // Compute tick from msb
  r = msb >= 128 ? ratio >> BigInt(msb - 127) : ratio << BigInt(127 - msb);

  let log_2 = (BigInt(msb) - 128n) << 64n;

  // Compute log_2 with precision
  for (let i = 0; i < 14; i++) {
    r = (r * r) >> 127n;
    const f = r >> 128n;
    log_2 = log_2 | (f << BigInt(63 - i));
    r = r >> f;
  }

  // Convert to tick
  const log_sqrt10001 = log_2 * BigInt('255738958999603826347141');
  
  const tickLow = Number((log_sqrt10001 - BigInt('3402992956809132418596140100660247210')) >> 128n);
  const tickHi = Number((log_sqrt10001 + BigInt('291339464771989622907027621153398088495')) >> 128n);

  return tickLow === tickHi ? tickLow : getSqrtRatioAtTick(tickHi) <= sqrtPriceX96 ? tickHi : tickLow;
}

/**
 * Get the nearest usable tick for a given tick and tick spacing
 * @param tick The tick value
 * @param tickSpacing The tick spacing
 * @returns The nearest usable tick
 */
export function nearestUsableTick(tick: number, tickSpacing: number): number {
  if (tickSpacing <= 0) {
    throw new Error('Tick spacing must be positive');
  }
  
  const rounded = Math.round(tick / tickSpacing) * tickSpacing;
  
  if (rounded < MIN_TICK) {
    return Math.ceil(MIN_TICK / tickSpacing) * tickSpacing;
  }
  
  if (rounded > MAX_TICK) {
    return Math.floor(MAX_TICK / tickSpacing) * tickSpacing;
  }
  
  return rounded;
}

/**
 * Get tick spacing for a fee tier
 * @param feeTier The fee tier (500, 3000, 10000)
 * @returns The tick spacing
 */
export function getTickSpacing(feeTier: number): number {
  switch (feeTier) {
    case 500:
      return 10;
    case 3000:
      return 60;
    case 10000:
      return 200;
    default:
      throw new Error(`Unknown fee tier: ${feeTier}`);
  }
}