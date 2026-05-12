#!/usr/bin/env node
/**
 * Generate PWA icons from a single SVG brand mark.
 * Outputs to public/icons/icon-{size}x{size}.png at the standard
 * PWA sizes, plus apple-touch-icon.png (180×180).
 *
 * Re-run with `node scripts/gen-icons.mjs` if the brand mark changes.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// Brand mark: 4 quadrants in a rounded square, mirroring the design
// tokens --color-member-1 (cobalt) and --color-member-2 (rose).
// Approximations of oklch(56% 0.18 258) and oklch(64% 0.16 12).
const COLOR_1 = '#2b5fff';
const COLOR_2 = '#e85a7a';
const BG = '#f5f5f7';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="r">
      <rect x="102" y="102" width="820" height="820" rx="180" />
    </clipPath>
  </defs>
  <rect width="1024" height="1024" fill="${BG}"/>
  <g clip-path="url(#r)">
    <rect x="102" y="102" width="410" height="410" fill="${COLOR_1}"/>
    <rect x="512" y="102" width="410" height="410" fill="${COLOR_2}"/>
    <rect x="102" y="512" width="410" height="410" fill="${COLOR_2}"/>
    <rect x="512" y="512" width="410" height="410" fill="${COLOR_1}"/>
  </g>
</svg>`;

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUT_DIR = path.resolve('public/icons');
const APPLE_OUT = path.resolve('public/apple-touch-icon.png');

await mkdir(OUT_DIR, { recursive: true });

const buf = Buffer.from(SVG);

for (const size of SIZES) {
  const out = path.join(OUT_DIR, `icon-${size}x${size}.png`);
  await sharp(buf).resize(size, size).png().toFile(out);
  console.log(`✓ ${out}`);
}

// Apple touch icon: 180×180, opaque background (iOS doesn't honour
// transparency on home-screen icons; rendering on cream looks clean).
await sharp(buf).resize(180, 180).png().toFile(APPLE_OUT);
console.log(`✓ ${APPLE_OUT}`);

console.log('\nDone.');
