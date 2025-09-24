// Basic test for our math functions
const { getSqrtRatioAtTick, getTickAtSqrtRatio } = require('./dist/src/math/tick_math');

console.log('Testing tick math functions...');

try {
  // Test basic tick to sqrt price conversion
  const sqrtPrice = getSqrtRatioAtTick(0);
  console.log('✓ getSqrtRatioAtTick(0) =', sqrtPrice.toString());
  
  // Test inverse conversion
  const tick = getTickAtSqrtRatio(sqrtPrice);
  console.log('✓ getTickAtSqrtRatio(sqrtPrice) =', tick);
  
  // Test they are inverses
  if (tick === 0) {
    console.log('✓ Tick math functions are working correctly!');
  } else {
    console.log('✗ Tick math functions failed inverse test');
  }
} catch (error) {
  console.error('✗ Error testing tick math:', error.message);
}