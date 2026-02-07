import * as THREE from 'three';
import type { ProcessedItem, StatInfo, ContentBlock } from '../../types';

// Higher resolution canvas = bigger, more readable text on the 3D card
const TEX_W = 1024;
const TEX_H = 1434;

// Universal scale factor (all sizes designed at 640x896, scaled up)
const S = TEX_W / 640;

const TYPE_COLORS: Record<string, { border: string; bg: string }> = {
  weapon:   { border: '#D4883A', bg: '#3d2a1a' },
  vitality: { border: '#4CAF50', bg: '#1e3320' },
  spirit:   { border: '#9C6FDF', bg: '#2a2040' },
};

/* ───────────── helpers ───────────── */

function toRoman(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V'][n - 1] || String(n);
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\{g:citadel_binding:'([^']+)'\}/gi, '[$1]')
    .trim();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Word-wrap text, respecting existing newlines */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxWidth && line) {
        result.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    result.push(line);
  }
  return result;
}

function getStatColor(value: string): string {
  const isNeg = value.startsWith('-') || value.startsWith('+-');
  return isNeg ? '#ff6b6b' : '#69db7c';
}

function getScaleColor(scalesWith: string): string {
  if (scalesWith === 'Spirit') return '#9C6FDF';
  if (scalesWith === 'Weapon') return '#D4A84B';
  return '#69db7c';
}

/* ═══════════════════════════════════════════════════
   FRONT FACE
   ═══════════════════════════════════════════════════ */

export function createFrontTexture(
  item: ProcessedItem,
  itemImage: HTMLImageElement | null,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;

  const colors = TYPE_COLORS[item.type] || TYPE_COLORS.weapon;
  const pad = 12 * S;
  const r = 22 * S;

  // Clip entire canvas to rounded rect so corners are transparent
  roundRect(ctx, 0, 0, TEX_W, TEX_H, r);
  ctx.clip();

  // Border
  ctx.fillStyle = colors.border;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Inner bg
  ctx.fillStyle = colors.bg;
  roundRect(ctx, pad, pad, TEX_W - pad * 2, TEX_H - pad * 2, r - 2);
  ctx.fill();

  // Image area
  const nameBarH = 160 * S;
  const imgAreaH = TEX_H - pad - nameBarH;

  if (itemImage) {
    ctx.save();
    roundRect(ctx, pad, pad, TEX_W - pad * 2, imgAreaH - pad, r - 2);
    ctx.clip();
    const iw = itemImage.naturalWidth;
    const ih = itemImage.naturalHeight;
    const areaW = TEX_W - pad * 2;
    const areaH = imgAreaH - pad;
    const scale = Math.max(areaW / iw, areaH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(itemImage, pad + (areaW - dw) / 2, pad, dw, dh);
    ctx.restore();
  }

  // Tier badge — top-right triangle
  const badgeSize = 120 * S;
  ctx.fillStyle = colors.border;
  ctx.beginPath();
  ctx.moveTo(TEX_W - pad, pad);
  ctx.lineTo(TEX_W - pad, pad + badgeSize);
  ctx.lineTo(TEX_W - pad - badgeSize, pad);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = `bold ${Math.round(44 * S)}px serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(toRoman(item.tier), TEX_W - pad - 14 * S, pad + 8 * S);

  // Name bar
  const nameBarY = TEX_H - nameBarH;
  ctx.fillStyle = colors.bg;
  ctx.beginPath();
  ctx.moveTo(pad, nameBarY);
  ctx.lineTo(TEX_W - pad, nameBarY);
  ctx.lineTo(TEX_W - pad, TEX_H - pad - r);
  ctx.quadraticCurveTo(TEX_W - pad, TEX_H - pad, TEX_W - pad - r, TEX_H - pad);
  ctx.lineTo(pad + r, TEX_H - pad);
  ctx.quadraticCurveTo(pad, TEX_H - pad, pad, TEX_H - pad - r);
  ctx.closePath();
  ctx.fill();

  // Name text
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(48 * S)}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nameLines = wrapText(ctx, item.displayName, TEX_W - 80 * S);
  const nameLineH = 56 * S;
  const nameStartY = nameBarY + nameBarH / 2 - ((nameLines.length - 1) * nameLineH) / 2;
  nameLines.forEach((line, i) => {
    ctx.fillText(line, TEX_W / 2, nameStartY + i * nameLineH);
  });

  // Active / Imbue tag
  if (item.isImbue) {
    const tagY = nameBarY - 56 * S;
    ctx.fillStyle = '#9C6FDF';
    ctx.fillRect(pad, tagY, TEX_W - pad * 2, 50 * S);
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(26 * S)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('IMBUE', TEX_W / 2, tagY + 25 * S);
  } else if (item.isActive) {
    const tagW = 140 * S;
    const tagH = 44 * S;
    const tagX = TEX_W / 2 - tagW / 2;
    const tagY = nameBarY - tagH / 2;
    ctx.fillStyle = '#000';
    roundRect(ctx, tagX, tagY, tagW, tagH, 6 * S);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(22 * S)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ACTIVE', TEX_W / 2, tagY + tagH / 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* ═══════════════════════════════════════════════════
   BACK FACE  — matches 2D Flashcard.tsx
   ═══════════════════════════════════════════════════ */

export function createBackTexture(
  item: ProcessedItem,
  itemImage: HTMLImageElement | null,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;

  const colors = TYPE_COLORS[item.type] || TYPE_COLORS.weapon;
  const pad = 12 * S;
  const r = 22 * S;
  const inL = pad;
  const inR = TEX_W - pad;
  const inW = inR - inL;
  const cPad = 22 * S;
  const leftX = inL + cPad;
  const maxTextW = inW - cPad * 2;

  // Clip entire canvas to rounded rect so corners are transparent
  roundRect(ctx, 0, 0, TEX_W, TEX_H, r);
  ctx.clip();

  // Border
  ctx.fillStyle = colors.border;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Inner bg
  ctx.fillStyle = colors.bg;
  roundRect(ctx, pad, pad, inW, TEX_H - pad * 2, r - 2);
  ctx.fill();

  let y = pad;

  /* ──── HEADER BAR ──── */
  const headerH = 110 * S;
  // Header bg with rounded top corners
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(inL + r, y);
  ctx.lineTo(inR - r, y);
  ctx.quadraticCurveTo(inR, y, inR, y + r);
  ctx.lineTo(inR, y + headerH);
  ctx.lineTo(inL, y + headerH);
  ctx.lineTo(inL, y + r);
  ctx.quadraticCurveTo(inL, y, inL + r, y);
  ctx.closePath();
  ctx.fill();

  // Header border-bottom
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 3 * S;
  ctx.beginPath();
  ctx.moveTo(inL, y + headerH);
  ctx.lineTo(inR, y + headerH);
  ctx.stroke();

  // Thumbnail
  const thumbS = 70 * S;
  const thumbX = inL + cPad;
  const thumbY = y + (headerH - thumbS) / 2;
  if (itemImage) {
    ctx.save();
    roundRect(ctx, thumbX, thumbY, thumbS, thumbS, 6 * S);
    ctx.clip();
    ctx.drawImage(itemImage, thumbX, thumbY, thumbS, thumbS);
    ctx.restore();
  }

  // Name
  const hTextX = thumbX + thumbS + 18 * S;
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(32 * S)}px Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let headerName = item.displayName;
  const maxHeaderNameW = inR - hTextX - cPad;
  while (ctx.measureText(headerName).width > maxHeaderNameW && headerName.length > 3) {
    headerName = headerName.slice(0, -1);
  }
  if (headerName !== item.displayName) headerName += '…';
  ctx.fillText(headerName, hTextX, y + headerH / 2 - 18 * S);

  // Cost & Tier subtitle
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `${Math.round(24 * S)}px Arial, sans-serif`;
  ctx.fillText(
    `${item.tier === 5 ? 'Legendary' : item.cost}  •  Tier ${item.tier}`,
    hTextX, y + headerH / 2 + 18 * S,
  );

  y += headerH;

  /* ──── Reusable drawing helpers (use `y` as cursor) ──── */

  /** Innate stats: simple inline rows  value  label */
  function drawInnateRows(stats: StatInfo[]) {
    const rowH = 38 * S;
    const sectionPadY = 16 * S;
    y += sectionPadY;

    for (const stat of stats) {
      // Value
      ctx.fillStyle = getStatColor(stat.value);
      ctx.font = `bold ${Math.round(26 * S)}px Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(stat.value, leftX, y);
      let cx = leftX + ctx.measureText(stat.value).width + 12 * S;

      // Scale indicator
      if (stat.scalesWith) {
        ctx.font = `bold ${Math.round(18 * S)}px Arial, sans-serif`;
        ctx.fillStyle = getScaleColor(stat.scalesWith);
        const tag = stat.scaleMultiplier ? `x${stat.scaleMultiplier}` : `↑${stat.scalesWith.charAt(0)}`;
        ctx.fillText(tag, cx, y + 4 * S);
        cx += ctx.measureText(tag).width + 12 * S;
      }

      // Label
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `${stat.hasBuiltInCondition ? 'bold ' : ''}${Math.round(24 * S)}px Arial, sans-serif`;
      const label = stat.label;
      ctx.fillText(label, cx, y + 2 * S, inR - cx - cPad);

      // Conditional tag
      if (stat.isConditional) {
        const labelW = ctx.measureText(label).width;
        ctx.fillStyle = '#ffa500';
        ctx.font = `italic ${Math.round(18 * S)}px Arial, sans-serif`;
        ctx.fillText(' (conditional)', cx + labelW, y + 4 * S);
      }

      y += rowH;
    }

    y += sectionPadY - 6 * S;

    // Bottom border
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(inL, y, inW, 2);
    y += 2;
  }

  /** 2-column stats grid (for passive/active stats) — matches 2D renderStatsGrid */
  function drawStatsGrid(stats: StatInfo[]) {
    const filtered = stats.filter(s => s.label !== 'Cooldown');
    if (filtered.length === 0) return;

    const gridPad = 16 * S;
    const gap = 12 * S;
    const cols = 2;
    const cellW = (inW - gridPad * 2 - gap) / cols;
    const cellH = 86 * S;
    const rows = Math.ceil(filtered.length / cols);

    y += 10 * S;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const idx = row * cols + col;
        if (idx >= filtered.length) break;
        const stat = filtered[idx];

        const cx = inL + gridPad + col * (cellW + gap);
        const cy = y;

        // Dark rounded cell bg
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        roundRect(ctx, cx, cy, cellW, cellH, 8 * S);
        ctx.fill();

        // Value (bold, colored, top of cell)
        ctx.fillStyle = getStatColor(stat.value);
        ctx.font = `bold ${Math.round(27 * S)}px Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(stat.value, cx + 14 * S, cy + 12 * S, cellW - 28 * S);

        // Scale indicator next to value
        if (stat.scalesWith) {
          const valW = Math.min(ctx.measureText(stat.value).width, cellW - 28 * S);
          const tag = stat.scaleMultiplier ? `x${stat.scaleMultiplier}` : `↑${stat.scalesWith.charAt(0)}`;
          ctx.font = `bold ${Math.round(17 * S)}px Arial, sans-serif`;
          const tagW = ctx.measureText(tag).width + 12 * S;
          ctx.fillStyle = 'rgba(0,0,0,0.4)';
          roundRect(ctx, cx + 14 * S + valW + 6 * S, cy + 12 * S, tagW, 26 * S, 4 * S);
          ctx.fill();
          ctx.fillStyle = getScaleColor(stat.scalesWith);
          ctx.fillText(tag, cx + 14 * S + valW + 12 * S, cy + 15 * S);
        }

        // Label (small, muted, bottom of cell)
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.font = `${stat.hasBuiltInCondition ? 'bold ' : ''}${Math.round(20 * S)}px Arial, sans-serif`;
        let label = stat.label;
        if (stat.isConditional) label += ' (cond)';
        ctx.fillText(label, cx + 14 * S, cy + 50 * S, cellW - 28 * S);
      }
      y += cellH + gap;
    }
    y -= gap; // undo trailing gap
    y += 6 * S;
  }

  /** Section header bar (PASSIVE / ACTIVE) */
  function drawSectionHeader(label: string, cooldown?: string) {
    const barH = 48 * S;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(inL, y, inW, barH);

    // Bottom border
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(inL, y + barH, inW, 2);

    // Label
    ctx.font = `bold ${Math.round(20 * S)}px Arial, sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.toUpperCase(), leftX, y + barH / 2);

    // Cooldown on right
    if (cooldown) {
      ctx.font = `${Math.round(20 * S)}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.textAlign = 'right';
      ctx.fillText(`⏱ ${cooldown}`, inR - cPad, y + barH / 2);
    }

    y += barH + 2;
  }

  /** Description paragraph */
  function drawDescription(desc: string, bgColor: string = 'rgba(0,0,0,0.2)') {
    const clean = stripHtml(desc);
    if (!clean) return;

    ctx.font = `${Math.round(24 * S)}px Arial, sans-serif`;
    const lines = wrapText(ctx, clean, maxTextW - 12 * S);
    const lineH = 33 * S;
    const maxLines = 6;
    const shown = Math.min(lines.length, maxLines);
    const blockH = shown * lineH + 24 * S + (lines.length > maxLines ? lineH : 0);

    // Background
    ctx.fillStyle = bgColor;
    ctx.fillRect(inL, y, inW, blockH);

    // Text
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = `${Math.round(24 * S)}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    for (let i = 0; i < shown; i++) {
      ctx.fillText(lines[i], leftX + 4 * S, y + 12 * S + i * lineH, maxTextW - 8 * S);
    }
    if (lines.length > maxLines) {
      ctx.fillText('…', leftX + 4 * S, y + 12 * S + shown * lineH);
    }

    y += blockH;
  }

  /** Render interleaved content blocks (descriptions + stat grids in order) */
  function drawContentBlocks(blocks: ContentBlock[], descBg: string = 'rgba(0,0,0,0.2)') {
    for (const block of blocks) {
      if (block.type === 'description') {
        drawDescription(block.text, descBg);
      } else if (block.type === 'stats') {
        drawStatsGrid(block.stats);
      }
    }
  }

  /* ──────── INNATE SECTION ──────── */
  const innateStats = item.stats.filter(s => s.section === 'innate');
  if (innateStats.length > 0) {
    drawInnateRows(innateStats);
  }

  /* ──────── PASSIVE SECTION ──────── */
  const passiveStats = item.stats.filter(s => s.section === 'passive' && s.label !== 'Cooldown');
  if (passiveStats.length > 0 || item.passiveDescription || item.passiveBlocks) {
    drawSectionHeader('Passive', item.passiveCooldown);

    if (item.passiveBlocks) {
      drawContentBlocks(item.passiveBlocks, 'rgba(0,0,0,0.2)');
    } else {
      if (item.passiveDescription) drawDescription(item.passiveDescription, 'rgba(0,0,0,0.2)');
      if (passiveStats.length > 0) drawStatsGrid(passiveStats);
    }
  }

  /* ──────── ACTIVE SECTION ──────── */
  const activeStats = item.stats.filter(s => s.section === 'active' && s.label !== 'Cooldown');
  if (item.isActive || activeStats.length > 0 || item.activeDescription || item.activeBlocks) {
    drawSectionHeader('Active', item.cooldown);

    const activeBg = 'rgba(156, 111, 223, 0.1)';

    if (item.activeBlocks) {
      drawContentBlocks(item.activeBlocks, activeBg);
    } else {
      if (item.activeDescription) {
        drawDescription(item.activeDescription, activeBg);
      } else if (item.passiveDescription && !item.hasPassiveSection) {
        drawDescription(item.passiveDescription, activeBg);
      }
      if (activeStats.length > 0) drawStatsGrid(activeStats);
    }
  }

  /* ──────── UPGRADE RELATIONSHIPS (bottom) ──────── */
  const hasComponents = item.componentItems && item.componentItems.length > 0;
  const hasUpgrades = item.upgradesTo && item.upgradesTo.length > 0;

  if (hasComponents || hasUpgrades) {
    const lineCount = (hasComponents ? 1 : 0) + (hasUpgrades ? 1 : 0);
    const blockH = lineCount * 34 * S + 28 * S;

    // Push toward bottom
    y = Math.max(y + 12 * S, TEX_H - pad - blockH - 8 * S);

    // Top border
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(inL, y, inW, 2);
    y += 2;

    // Background with rounded bottom corners
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.moveTo(inL, y);
    ctx.lineTo(inR, y);
    ctx.lineTo(inR, TEX_H - pad - r);
    ctx.quadraticCurveTo(inR, TEX_H - pad, inR - r, TEX_H - pad);
    ctx.lineTo(inL + r, TEX_H - pad);
    ctx.quadraticCurveTo(inL, TEX_H - pad, inL, TEX_H - pad - r);
    ctx.closePath();
    ctx.fill();

    y += 12 * S;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (hasComponents) {
      ctx.font = `${Math.round(22 * S)}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      const prefix = 'Upgrades from: ';
      ctx.fillText(prefix, leftX, y);
      const prefixW = ctx.measureText(prefix).width;
      ctx.fillStyle = '#ffd700';
      ctx.fillText(
        item.componentItems.map(c => c.name).join(', '),
        leftX + prefixW, y,
        maxTextW - prefixW,
      );
      y += 34 * S;
    }

    if (hasUpgrades) {
      ctx.font = `${Math.round(22 * S)}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      const prefix = 'Upgrades to: ';
      ctx.fillText(prefix, leftX, y);
      const prefixW = ctx.measureText(prefix).width;
      ctx.fillStyle = '#69db7c';
      ctx.fillText(
        item.upgradesTo.map(u => u.name).join(', '),
        leftX + prefixW, y,
        maxTextW - prefixW,
      );
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
