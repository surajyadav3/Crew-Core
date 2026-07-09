// Generates professional CrewCore icons using sharp + inline SVG
// Run: node generate-icons.mjs

import sharp from 'sharp';
import { writeFileSync } from 'fs';

const W = 1024;

// ── SVG design: dark navy bg, gradient accent hexagon, white CC monogram ───────
const iconSvg = `
<svg width="${W}" height="${W}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0A0F1E"/>
      <stop offset="100%" stop-color="#0D1F3C"/>
    </linearGradient>
    <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7C6FF7"/>
      <stop offset="100%" stop-color="#5849C2"/>
    </linearGradient>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6C5CE7" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#5849C2" stop-opacity="0.08"/>
    </linearGradient>
    <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="60%" stop-color="#EDE9FE"/>
      <stop offset="100%" stop-color="#C4B5FD"/>
    </linearGradient>
    <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#6C5CE7" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#6C5CE7" stop-opacity="0"/>
    </radialGradient>
    <filter id="softBlur">
      <feGaussianBlur stdDeviation="2"/>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${W}" fill="url(#bg)"/>

  <!-- Subtle dot grid -->
  ${Array.from({ length: 10 }, (_, row) =>
    Array.from({ length: 10 }, (_, col) => {
      const x = 80 + col * 96;
      const y = 80 + row * 96;
      return `<circle cx="${x}" cy="${y}" r="2" fill="#FFFFFF" opacity="0.035"/>`;
    }).join('')
  ).join('')}

  <!-- Outer ambient glow -->
  <circle cx="${W/2}" cy="${W/2}" r="400" fill="url(#centerGlow)"/>

  <!-- Outer ring -->
  <circle cx="${W/2}" cy="${W/2}" r="365" fill="none" stroke="url(#ringGrad)" stroke-width="1.5"/>

  <!-- Middle ring -->
  <circle cx="${W/2}" cy="${W/2}" r="295" fill="none" stroke="#6C5CE7" stroke-width="1" opacity="0.12"/>

  <!-- Main icon plate (rounded square) -->
  <rect x="262" y="262" width="500" height="500" rx="110" ry="110" fill="url(#hexGrad)"/>

  <!-- Plate inner highlight -->
  <rect x="262" y="262" width="500" height="180" rx="110" ry="110" fill="#FFFFFF" opacity="0.04"/>
  <rect x="262" y="262" width="500" height="500" rx="110" ry="110"
        fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.12"/>

  <!-- Shine sweep on plate -->
  <rect x="262" y="262" width="160" height="500" rx="0" fill="#FFFFFF" opacity="0.03"/>

  <!-- "CC" monogram -->
  <!-- C1 -->
  <text x="432" y="612"
    font-family="Arial Black, Arial, sans-serif"
    font-size="260"
    font-weight="900"
    text-anchor="middle"
    fill="url(#textGrad)"
    letter-spacing="-8">C</text>
  <!-- C2 -->
  <text x="622" y="612"
    font-family="Arial Black, Arial, sans-serif"
    font-size="260"
    font-weight="900"
    text-anchor="middle"
    fill="#BFDBFE"
    opacity="0.85"
    letter-spacing="-8">C</text>

  <!-- Accent line under CC -->
  <rect x="362" y="710" width="300" height="5" rx="2.5" fill="#A78BFA" opacity="0.55"/>

  <!-- Bottom dot indicator -->
  <circle cx="${W/2}" cy="860" r="14" fill="#6C5CE7" opacity="0.6"/>
  <circle cx="${W/2}" cy="860" r="7" fill="#A78BFA"/>
</svg>`;

// ── Adaptive icon foreground (no background — transparent) ────────────────────
const adaptiveSvg = `
<svg width="${W}" height="${W}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7C6FF7"/>
      <stop offset="100%" stop-color="#5849C2"/>
    </linearGradient>
    <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#C4B5FD"/>
    </linearGradient>
  </defs>

  <!-- Plate -->
  <rect x="187" y="187" width="650" height="650" rx="140" ry="140" fill="url(#hexGrad)"/>

  <!-- Plate border -->
  <rect x="187" y="187" width="650" height="650" rx="140" ry="140"
        fill="none" stroke="#FFFFFF" stroke-width="2" opacity="0.15"/>

  <!-- CC text -->
  <text x="404" y="620"
    font-family="Arial Black, Arial, sans-serif"
    font-size="280"
    font-weight="900"
    text-anchor="middle"
    fill="url(#textGrad)"
    letter-spacing="-10">C</text>
  <text x="622" y="620"
    font-family="Arial Black, Arial, sans-serif"
    font-size="280"
    font-weight="900"
    text-anchor="middle"
    fill="#C4B5FD"
    opacity="0.85"
    letter-spacing="-10">C</text>

  <!-- Underline -->
  <rect x="312" y="720" width="400" height="5" rx="2.5" fill="#A78BFA" opacity="0.6"/>
</svg>`;

// ── Splash PNG (1242×2436 portrait) ──────────────────────────────────────────
const SW = 1242, SH = 2436;
const splashSvg = `
<svg width="${SW}" height="${SH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="60%" y2="100%">
      <stop offset="0%" stop-color="#080D1A"/>
      <stop offset="100%" stop-color="#0A1628"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="46%" r="38%">
      <stop offset="0%" stop-color="#6C5CE7" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#6C5CE7" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hexGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7C6FF7"/>
      <stop offset="100%" stop-color="#5849C2"/>
    </linearGradient>
  </defs>

  <rect width="${SW}" height="${SH}" fill="url(#bg)"/>
  <rect width="${SW}" height="${SH}" fill="url(#glow)"/>

  <!-- Icon plate -->
  <rect x="${SW/2 - 110}" y="${SH/2 - 280}" width="220" height="220" rx="48" ry="48" fill="url(#hexGrad)"/>
  <rect x="${SW/2 - 110}" y="${SH/2 - 280}" width="220" height="220" rx="48" ry="48"
        fill="none" stroke="#FFFFFF" stroke-width="1.5" opacity="0.15"/>

  <!-- CC in plate -->
  <text x="${SW/2 - 18}" y="${SH/2 - 108}"
    font-family="Arial Black, Arial, sans-serif"
    font-size="90" font-weight="900" text-anchor="middle"
    fill="#FFFFFF" letter-spacing="-2">CC</text>

  <!-- App name -->
  <text x="${SW/2}" y="${SH/2 + 30}"
    font-family="Arial, sans-serif"
    font-size="72" font-weight="700" text-anchor="middle"
    fill="#FFFFFF" letter-spacing="-1">CrewCore</text>

  <!-- Tagline -->
  <text x="${SW/2}" y="${SH/2 + 96}"
    font-family="Arial, sans-serif"
    font-size="30" font-weight="400" text-anchor="middle"
    fill="#A78BFA" letter-spacing="4">SMART PAYROLL · MODERN TEAMS</text>

  <!-- Bottom bar -->
  <rect x="${SW/2 - 60}" y="${SH - 220}" width="120" height="5" rx="2.5" fill="#6C5CE7" opacity="0.6"/>
</svg>`;

async function generate() {
  console.log('Generating icon.png …');
  await sharp(Buffer.from(iconSvg))
    .png()
    .toFile('assets/icon.png');

  console.log('Generating adaptive-icon.png …');
  await sharp(Buffer.from(adaptiveSvg))
    .png()
    .toFile('assets/adaptive-icon.png');

  console.log('Generating favicon.png (32×32) …');
  await sharp(Buffer.from(adaptiveSvg))
    .resize(32, 32)
    .png()
    .toFile('assets/favicon.png');

  console.log('Generating splash.png …');
  await sharp(Buffer.from(splashSvg))
    .png()
    .toFile('assets/splash.png');

  console.log('Done. All assets written to assets/');
}

generate().catch(console.error);
