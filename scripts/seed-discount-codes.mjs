#!/usr/bin/env node

/**
 * Bulk QR code generator, ingestion, and seeding script.
 *
 * Supports generating QR codes from a plain text file (one code per line),
 * rendering the text code neatly beneath the QR code, saving as an image,
 * uploading to R2 with unguessable UUIDs, and seeding the D1 database.
 *
 * Usage:
 *   node scripts/seed-discount-codes.mjs --file ./codes.txt [--remote | --local]
 *   node scripts/seed-discount-codes.mjs --dir ./qr_images [--remote | --local]
 *   node scripts/seed-discount-codes.mjs --mock 5 [--remote | --local]
 *
 * Flags:
 *   --file <path>      Text file containing one discount code per line (no commas)
 *   --dir <path>       Directory containing pre-rendered image files (.png, .jpg, .svg)
 *   --mock <count>     Generate and seed N dummy discount codes (e.g. TABVAR-PROMO-0001)
 *   --format <png|svg> Image format for generated QR codes (default: png)
 *   --remote           Target Cloudflare remote D1 and R2 (production)
 *   --local            Target local miniflare D1 and R2 (default)
 *   --bucket <name>    Override target R2 bucket name (default: tabvar-misc or tabvar-misc-dev)
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import QRCode from 'qrcode';
import sharp from 'sharp';

const args = process.argv.slice(2);

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return null;
}

const isRemote = args.includes('--remote');
const targetFlag = isRemote ? '--remote' : '--local';
const fileArg = getArgValue('--file');
const dirArg = getArgValue('--dir');
const logoArg = getArgValue('--logo');
const mockArg = getArgValue('--mock');
const customBucket = getArgValue('--bucket');
const format = (getArgValue('--format') || 'png').toLowerCase();

const defaultBucket = isRemote ? 'tabvar-misc' : 'tabvar-misc-dev';
const bucketName = customBucket || defaultBucket;

console.log(`[Seed Discounts] Target: ${isRemote ? 'REMOTE (Cloudflare Production)' : 'LOCAL (Miniflare)'}`);
console.log(`[Seed Discounts] Bucket: ${bucketName}`);
console.log(`[Seed Discounts] Image format: ${format.toUpperCase()}`);
if (logoArg) {
  console.log(`[Seed Discounts] Logo: ${logoArg}`);
}

function executeCommand(cmd) {
  return execSync(cmd, { stdio: 'inherit' });
}

/**
 * Builds an image (PNG or SVG) containing the QR code and the text printed below it,
 * with an optional centered logo.
 */
async function generateQrImageWithText(codeText, outputFormat = 'png', logoPath = null) {
  const qrSize = 400;
  const cardWidth = 460;
  const cardHeight = 520;

  // 1. Generate QR code PNG
  const qrBuffer = await QRCode.toBuffer(codeText, {
    type: 'png',
    width: qrSize,
    margin: 1,
    errorCorrectionLevel: logoPath ? 'H' : 'M',
    color: {
      dark: '#111827',
      light: '#ffffff',
    },
  });

  // 2. If logo provided, composite logo in center of QR
  let finalQrBuffer = qrBuffer;
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      const logoSize = 80;
      const badgeSize = 96;

      const resizedLogo = await sharp(logoPath)
        .resize({ width: logoSize, height: logoSize, fit: 'inside' })
        .png()
        .toBuffer();

      const logoMeta = await sharp(resizedLogo).metadata();

      const badgeSvg = `
        <svg width="${badgeSize}" height="${badgeSize}">
          <rect width="${badgeSize}" height="${badgeSize}" rx="16" fill="#ffffff" stroke="#ffffff" stroke-width="4"/>
        </svg>
      `;
      const badgeBuffer = Buffer.from(badgeSvg);

      const qrWithLogo = await sharp(qrBuffer)
        .composite([
          {
            input: badgeBuffer,
            top: Math.round((qrSize - badgeSize) / 2),
            left: Math.round((qrSize - badgeSize) / 2),
          },
          {
            input: resizedLogo,
            top: Math.round((qrSize - (logoMeta.height || logoSize)) / 2),
            left: Math.round((qrSize - (logoMeta.width || logoSize)) / 2),
          },
        ])
        .png()
        .toBuffer();

      finalQrBuffer = qrWithLogo;
    } catch (err) {
      console.warn(`[Seed Discounts] Warning: could not overlay logo ${logoPath}:`, err.message);
    }
  }

  // 3. Text label SVG
  const textLength = codeText.length;
  let fontSize = 22;
  if (textLength > 30) {
    fontSize = 15;
  } else if (textLength > 24) {
    fontSize = 18;
  }

  const safeText = codeText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const textSvg = `
    <svg width="${cardWidth}" height="80">
      <text x="${cardWidth / 2}" y="45" 
        text-anchor="middle" 
        font-family="'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Consolas, monospace" 
        font-size="${fontSize}" 
        font-weight="700" 
        fill="#1f2937" 
        letter-spacing="1">
        ${safeText}
      </text>
    </svg>
  `;

  // 4. Create base white card and composite QR + text
  return sharp({
    create: {
      width: cardWidth,
      height: cardHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      {
        input: finalQrBuffer,
        top: 25,
        left: Math.round((cardWidth - qrSize) / 2),
      },
      {
        input: Buffer.from(textSvg),
        top: 425,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
}

async function main() {
  const tempDir = path.join(process.cwd(), '.temp_discount_uploads');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  const tasks = []; // Array of { filePath, codeLabel }

  if (fileArg) {
    const resolvedFile = path.resolve(fileArg);
    if (!fs.existsSync(resolvedFile)) {
      console.error(`Error: File not found: ${resolvedFile}`);
      process.exit(1);
    }
    const content = fs.readFileSync(resolvedFile, 'utf-8');
    const rawLines = content.split(/\r?\n/);
    const codes = rawLines
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    console.log(`[Seed Discounts] Found ${codes.length} codes in ${resolvedFile}`);

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const imageBuffer = await generateQrImageWithText(code, format, logoArg);
      const tempPath = path.join(tempDir, `code_${i + 1}.${format}`);
      fs.writeFileSync(tempPath, imageBuffer);
      tasks.push({ filePath: tempPath, codeLabel: code });
    }
  } else if (mockArg) {
    const count = parseInt(mockArg, 10) || 5;
    console.log(`[Seed Discounts] Generating ${count} mock QR codes with labels...`);

    for (let i = 1; i <= count; i++) {
      const mockCode = `TABVAR-PROMO-2026-${String(i).padStart(4, '0')}`;
      const imageBuffer = await generateQrImageWithText(mockCode, format, logoArg);
      const tempPath = path.join(tempDir, `mock_${i}.${format}`);
      fs.writeFileSync(tempPath, imageBuffer);
      tasks.push({ filePath: tempPath, codeLabel: mockCode });
    }
  } else if (dirArg) {
    const resolvedDir = path.resolve(dirArg);
    if (!fs.existsSync(resolvedDir)) {
      console.error(`Error: Directory not found: ${resolvedDir}`);
      process.exit(1);
    }
    const files = fs.readdirSync(resolvedDir);
    const validExts = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (validExts.includes(ext)) {
        tasks.push({
          filePath: path.join(resolvedDir, f),
          codeLabel: path.basename(f, ext),
        });
      }
    }
    console.log(`[Seed Discounts] Found ${tasks.length} pre-rendered image files in ${resolvedDir}`);
  } else {
    console.log(`
Usage:
  node scripts/seed-discount-codes.mjs --file <codes.txt> [--logo <path>] [--remote | --local] [--format png|svg]
  node scripts/seed-discount-codes.mjs --mock <count> [--logo <path>] [--remote | --local]
  node scripts/seed-discount-codes.mjs --dir <folder_with_images> [--remote | --local]

Examples:
  # Generate QR images from text file with TABVAR logo and upload to local dev:
  node scripts/seed-discount-codes.mjs --file ./codes.txt --logo ./public/tabvar.png --local

  # Generate QR images from text file and upload to production:
  node scripts/seed-discount-codes.mjs --file ./codes.txt --logo ./public/tabvar.png --remote

  # Generate 5 mock codes locally for quick testing:
  node scripts/seed-discount-codes.mjs --mock 5 --local
`);
    process.exit(0);
  }

  if (tasks.length === 0) {
    console.warn('[Seed Discounts] No codes to upload.');
    return;
  }

  console.log(`\n[Seed Discounts] Uploading ${tasks.length} QR images to R2 and seeding D1...`);

  let successCount = 0;
  for (let idx = 0; idx < tasks.length; idx++) {
    const { filePath, codeLabel } = tasks[idx];
    const ext = path.extname(filePath).toLowerCase() || `.${format}`;
    const uuid = crypto.randomUUID();
    const objectKey = `${uuid}${ext}`;

    const mimeType =
      ext === ".svg"
        ? "image/svg+xml"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : "image/png";

    try {
      console.log(`\n[${idx + 1}/${tasks.length}] Code: "${codeLabel}" -> ${objectKey}...`);
      // In this repository (see AGENTS.md Invariant 2.F), R2 buckets in dev use "remote": true,
      // connecting to Cloudflare R2. Therefore, R2 uploads must upload with --remote.
      executeCommand(
        `npx wrangler r2 object put "${bucketName}/${objectKey}" --file "${filePath}" --content-type "${mimeType}" --remote`
      );

      console.log(`Inserting key into D1 user_discount_code...`);
      const insertSql = `INSERT INTO user_discount_code (code_key) VALUES ('${objectKey}');`;
      executeCommand(`npx wrangler d1 execute DB ${targetFlag} --command "${insertSql}"`);

      successCount++;
    } catch (err) {
      console.error(`Failed to process code "${codeLabel}":`, err.message);
    }
  }

  console.log(`\n======================================================`);
  console.log(`[Seed Discounts] Successfully seeded ${successCount}/${tasks.length} discount codes!`);
  console.log(`======================================================\n`);

  // Clean up temp directory
  try {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  } catch {}
}

main().catch((err) => {
  console.error('[Seed Discounts] Unhandled error:', err);
  process.exit(1);
});
