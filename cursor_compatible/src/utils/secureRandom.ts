import crypto from 'crypto';

/**
 * Critical: cryptographically secure random helpers to replace Math.random for IDs and tokens
 */

export function randomId(prefix = '', length = 16): string {
  const bytes = crypto.randomBytes(length);
  return prefix + bytes.toString('hex');
}

export function randomInt(minInclusive: number, maxInclusive: number): number {
  // Returns a secure random integer in [minInclusive, maxInclusive]
  const range = maxInclusive - minInclusive + 1;
  if (range <= 0) throw new Error('Invalid range');
  const max = 0xffffffff;
  let x = 0;
  do {
    x = crypto.randomBytes(4).readUInt32BE(0);
  } while (x === max);
  return minInclusive + Math.floor((x / max) * range);
}

export function randomChoice<T>(items: T[]): T {
  if (items.length === 0) throw new Error('Cannot choose from empty array');
  const idx = randomInt(0, items.length - 1);
  return items[idx];
}


