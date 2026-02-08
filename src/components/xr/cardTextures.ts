import * as THREE from 'three';
import type { ProcessedItem, StatInfo, ContentBlock } from '../../types';

// Higher resolution canvas = bigger, more readable text on the 3D card
export const TEX_W = 1024;
export const TEX_H = 1434;

// Universal scale factor (all sizes designed at 640x896, scaled up)
const S = TEX_W / 640;

/* ───────────── Layout constants (shared by frame + content textures) ───────────── */

const PAD = 12 * S;           // Border thickness / outer padding
const CORNER_R = 22 * S;      // Rounded corner radius
const HEADER_H = 110 * S;     // Back-face header bar height (thumbnail + name)
const CONTENT_PAD = 22 * S;   // Inner content padding from border edge

// Derived inner-area bounds (pixel space)
const IN_L = PAD;
const IN_R = TEX_W - PAD;
const IN_W = IN_R - IN_L;
const LEFT_X = IN_L + CONTENT_PAD;
const MAX_TEXT_W = IN_W - CONTENT_PAD * 2;

// Content area dimensions (pixel space, for the back face)
export const CONTENT_TOP_PX = PAD + HEADER_H;
const CONTENT_BOTTOM_PX = TEX_H - PAD;
const CONTENT_CLEAR_BOTTOM_PX = CONTENT_BOTTOM_PX - CORNER_R;

/** Compute the pixel height of the upgrade-relationship footer for a given item. */
export function getUpgradeFooterH(item: ProcessedItem): number {
  const hasComponents = item.componentItems && item.componentItems.length > 0;
  const hasUpgrades = item.upgradesTo && item.upgradesTo.length > 0;
  if (!hasComponents && !hasUpgrades) return 0;
  const lineCount = (hasComponents ? 1 : 0) + (hasUpgrades ? 1 : 0);
  // divider(2) + top pad(12*S) + lines + bottom pad(16*S)
  return 2 + 12 * S + lineCount * 34 * S + 16 * S;
}

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
  let processed = html
    .replace(/\{g:citadel_binding:'([^']+)'\}/gi, '[$1]')
    .replace(/\{[^}]*\}/g, '');
  processed = processed.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
  processed = processed.replace(/<br\s*\/?>/gi, '\n');
  const div = document.createElement('div');
  div.innerHTML = processed;
  const text = div.textContent || div.innerText || '';
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n +/g, '\n')
    .replace(/ +\n/g, '\n')
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

/** Round only the top corners; bottom corners are square */
function roundRectTop(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
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

  // Clip entire canvas to rounded rect so corners are transparent
  roundRect(ctx, 0, 0, TEX_W, TEX_H, CORNER_R);
  ctx.clip();

  // Border
  ctx.fillStyle = colors.border;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Inner bg
  ctx.fillStyle = colors.bg;
  roundRect(ctx, PAD, PAD, TEX_W - PAD * 2, TEX_H - PAD * 2, CORNER_R - 2);
  ctx.fill();

  // Image area
  const nameBarH = 160 * S;
  const imgAreaH = TEX_H - PAD - nameBarH;

  if (itemImage) {
    ctx.save();
    roundRectTop(ctx, PAD, PAD, TEX_W - PAD * 2, imgAreaH - PAD, CORNER_R - 2);
    ctx.clip();
    const iw = itemImage.naturalWidth;
    const ih = itemImage.naturalHeight;
    const areaW = TEX_W - PAD * 2;
    const areaH = imgAreaH - PAD;
    const scale = Math.max(areaW / iw, areaH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.drawImage(itemImage, PAD + (areaW - dw) / 2, PAD, dw, dh);
    ctx.restore();
  }

  // Tier badge — top-right triangle
  const badgeSize = 120 * S;
  ctx.fillStyle = colors.border;
  ctx.beginPath();
  ctx.moveTo(TEX_W - PAD, PAD);
  ctx.lineTo(TEX_W - PAD, PAD + badgeSize);
  ctx.lineTo(TEX_W - PAD - badgeSize, PAD);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = `bold ${Math.round(44 * S)}px serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(toRoman(item.tier), TEX_W - PAD - 14 * S, PAD + 8 * S);

  // Name bar
  const nameBarY = TEX_H - nameBarH;
  ctx.fillStyle = colors.bg;
  ctx.beginPath();
  ctx.moveTo(PAD, nameBarY);
  ctx.lineTo(TEX_W - PAD, nameBarY);
  ctx.lineTo(TEX_W - PAD, TEX_H - PAD - CORNER_R);
  ctx.quadraticCurveTo(TEX_W - PAD, TEX_H - PAD, TEX_W - PAD - CORNER_R, TEX_H - PAD);
  ctx.lineTo(PAD + CORNER_R, TEX_H - PAD);
  ctx.quadraticCurveTo(PAD, TEX_H - PAD, PAD, TEX_H - PAD - CORNER_R);
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
    ctx.fillRect(PAD, tagY, TEX_W - PAD * 2, 50 * S);
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
   BACK FACE — FRAME (static layer)
   Border + header + bottom strip. Content area is
   transparent so the scrollable content mesh shows
   through from behind.
   ═══════════════════════════════════════════════════ */

export function createBackFrameTexture(
  item: ProcessedItem,
  itemImage: HTMLImageElement | null,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;

  const colors = TYPE_COLORS[item.type] || TYPE_COLORS.weapon;

  // Clip to rounded rect
  roundRect(ctx, 0, 0, TEX_W, TEX_H, CORNER_R);
  ctx.clip();

  // Border fill
  ctx.fillStyle = colors.border;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  // Inner bg
  ctx.fillStyle = colors.bg;
  roundRect(ctx, PAD, PAD, IN_W, TEX_H - PAD * 2, CORNER_R - 2);
  ctx.fill();

  /* ──── HEADER BAR ──── */
  let y = PAD;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(IN_L + CORNER_R, y);
  ctx.lineTo(IN_R - CORNER_R, y);
  ctx.quadraticCurveTo(IN_R, y, IN_R, y + CORNER_R);
  ctx.lineTo(IN_R, y + HEADER_H);
  ctx.lineTo(IN_L, y + HEADER_H);
  ctx.lineTo(IN_L, y + CORNER_R);
  ctx.quadraticCurveTo(IN_L, y, IN_L + CORNER_R, y);
  ctx.closePath();
  ctx.fill();

  // Divider line under header
  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 3 * S;
  ctx.beginPath();
  ctx.moveTo(IN_L, y + HEADER_H);
  ctx.lineTo(IN_R, y + HEADER_H);
  ctx.stroke();

  // Thumbnail
  const thumbS = 70 * S;
  const thumbX = IN_L + CONTENT_PAD;
  const thumbY = y + (HEADER_H - thumbS) / 2;
  if (itemImage) {
    ctx.save();
    roundRect(ctx, thumbX, thumbY, thumbS, thumbS, 6 * S);
    ctx.clip();
    ctx.drawImage(itemImage, thumbX, thumbY, thumbS, thumbS);
    ctx.restore();
  }

  // Name text
  const hTextX = thumbX + thumbS + 18 * S;
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(32 * S)}px Arial, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let headerName = item.displayName;
  const maxHeaderNameW = IN_R - hTextX - CONTENT_PAD;
  while (ctx.measureText(headerName).width > maxHeaderNameW && headerName.length > 3) {
    headerName = headerName.slice(0, -1);
  }
  if (headerName !== item.displayName) headerName += '…';
  ctx.fillText(headerName, hTextX, y + HEADER_H / 2 - 18 * S);

  // Cost & Tier subtitle
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `${Math.round(24 * S)}px Arial, sans-serif`;
  ctx.fillText(
    `${item.tier === 5 ? 'Legendary' : item.cost}  •  Tier ${item.tier}`,
    hTextX, y + HEADER_H / 2 + 18 * S,
  );

  /* ──── UPGRADE FOOTER (anchored to card bottom with rounded corners) ──── */
  const footerH = getUpgradeFooterH(item);
  const footerTop = CONTENT_CLEAR_BOTTOM_PX - footerH;

  if (footerH > 0) {
    const hasComponents = item.componentItems && item.componentItems.length > 0;
    const hasUpgrades = item.upgradesTo && item.upgradesTo.length > 0;

    let fy = footerTop;

    // Divider line
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(IN_L, fy, IN_W, 2);
    fy += 2;

    // Background — extends to bottom with rounded corners
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    ctx.moveTo(IN_L, fy);
    ctx.lineTo(IN_R, fy);
    ctx.lineTo(IN_R, CONTENT_BOTTOM_PX - (CORNER_R - 2));
    ctx.quadraticCurveTo(IN_R, CONTENT_BOTTOM_PX, IN_R - (CORNER_R - 2), CONTENT_BOTTOM_PX);
    ctx.lineTo(IN_L + (CORNER_R - 2), CONTENT_BOTTOM_PX);
    ctx.quadraticCurveTo(IN_L, CONTENT_BOTTOM_PX, IN_L, CONTENT_BOTTOM_PX - (CORNER_R - 2));
    ctx.closePath();
    ctx.fill();

    // Vertically center text within the footer box
    const lineCount = (hasComponents ? 1 : 0) + (hasUpgrades ? 1 : 0);
    const textBlockH = lineCount * 34 * S;
    const boxTop = footerTop + 2; // after divider
    fy = boxTop + (CONTENT_BOTTOM_PX - boxTop - textBlockH) / 2 + 5 * S;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    if (hasComponents) {
      ctx.font = `${Math.round(22 * S)}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      const prefix = 'Upgrades from: ';
      ctx.fillText(prefix, LEFT_X, fy);
      const prefixW = ctx.measureText(prefix).width;
      ctx.fillStyle = '#ffd700';
      ctx.fillText(
        item.componentItems.map(c => c.name).join(', '),
        LEFT_X + prefixW, fy,
        MAX_TEXT_W - prefixW,
      );
      fy += 34 * S;
    }

    if (hasUpgrades) {
      ctx.font = `${Math.round(22 * S)}px Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      const prefix = 'Upgrades to: ';
      ctx.fillText(prefix, LEFT_X, fy);
      const prefixW = ctx.measureText(prefix).width;
      ctx.fillStyle = '#69db7c';
      ctx.fillText(
        item.upgradesTo.map(u => u.name).join(', '),
        LEFT_X + prefixW, fy,
        MAX_TEXT_W - prefixW,
      );
    }
  }

  /* ──── Punch out the content area (make it transparent) ──── */
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fillRect(IN_L, CONTENT_TOP_PX, IN_W, footerTop - CONTENT_TOP_PX - 2);
  ctx.restore();

  // Bottom strip with rounded corners (only needed when no footer)
  if (footerH === 0) {
    ctx.fillStyle = colors.bg;
    ctx.beginPath();
    ctx.moveTo(IN_L, CONTENT_CLEAR_BOTTOM_PX);
    ctx.lineTo(IN_R, CONTENT_CLEAR_BOTTOM_PX);
    ctx.lineTo(IN_R, CONTENT_BOTTOM_PX - (CORNER_R - 2));
    ctx.quadraticCurveTo(IN_R, CONTENT_BOTTOM_PX, IN_R - (CORNER_R - 2), CONTENT_BOTTOM_PX);
    ctx.lineTo(IN_L + (CORNER_R - 2), CONTENT_BOTTOM_PX);
    ctx.quadraticCurveTo(IN_L, CONTENT_BOTTOM_PX, IN_L, CONTENT_BOTTOM_PX - (CORNER_R - 2));
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  (texture as any)._footerH = footerH;
  return texture;
}

/* ═══════════════════════════════════════════════════
   BACK FACE — CONTENT (scrollable layer)
   Stats, descriptions, upgrades — no border, no header.
   Sits behind the frame mesh and scrolls via UV offset.
   ═══════════════════════════════════════════════════ */

export function createBackContentTexture(
  item: ProcessedItem,
): THREE.CanvasTexture {
  const colors = TYPE_COLORS[item.type] || TYPE_COLORS.weapon;
  const footerH = getUpgradeFooterH(item);
  const contentAreaPx = CONTENT_CLEAR_BOTTOM_PX - CONTENT_TOP_PX - footerH;

  /** Draw all scrollable content onto a canvas of the given height.
   *  Returns the canvas and the final Y cursor position. */
  function drawContent(canvasH: number): { canvas: HTMLCanvasElement; finalY: number } {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    // Fill with card bg color (the frame masks the edges)
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, TEX_W, canvasH);

    // Left/right border strips (visible behind the frame's border area)
    ctx.fillStyle = colors.border;
    ctx.fillRect(0, 0, PAD, canvasH);
    ctx.fillRect(TEX_W - PAD, 0, PAD, canvasH);

    let y = 0;

    /* ──── Drawing helpers (close over ctx, y, layout constants) ──── */

    function drawInnateRows(stats: StatInfo[]) {
      const rowH = 38 * S;
      const sectionPadY = 16 * S;
      y += sectionPadY;
      for (const stat of stats) {
        ctx.fillStyle = getStatColor(stat.value);
        ctx.font = `bold ${Math.round(26 * S)}px Arial, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(stat.value, LEFT_X, y);
        let cx = LEFT_X + ctx.measureText(stat.value).width + 12 * S;
        if (stat.scalesWith) {
          ctx.font = `bold ${Math.round(18 * S)}px Arial, sans-serif`;
          ctx.fillStyle = getScaleColor(stat.scalesWith);
          const tag = stat.scaleMultiplier ? `x${stat.scaleMultiplier}` : `↑${stat.scalesWith.charAt(0)}`;
          ctx.fillText(tag, cx, y + 4 * S);
          cx += ctx.measureText(tag).width + 12 * S;
        }
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.font = `${stat.hasBuiltInCondition ? 'bold ' : ''}${Math.round(24 * S)}px Arial, sans-serif`;
        const label = stat.label;
        ctx.fillText(label, cx, y + 2 * S, IN_R - cx - CONTENT_PAD);
        if (stat.isConditional) {
          const labelW = ctx.measureText(label).width;
          ctx.fillStyle = '#ffa500';
          ctx.font = `italic ${Math.round(18 * S)}px Arial, sans-serif`;
          ctx.fillText(' (conditional)', cx + labelW, y + 4 * S);
        }
        y += rowH;
      }
      y += sectionPadY - 6 * S;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(IN_L, y, IN_W, 2);
      y += 2;
    }

    function drawStatsGrid(stats: StatInfo[]) {
      const filtered = stats.filter(s => s.label !== 'Cooldown');
      if (filtered.length === 0) return;
      const gridPad = 16 * S;
      const gap = 12 * S;
      const cols = 2;
      const cellW = (IN_W - gridPad * 2 - gap) / cols;
      const cellH = 86 * S;
      const rows = Math.ceil(filtered.length / cols);
      y += 10 * S;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const idx = row * cols + col;
          if (idx >= filtered.length) break;
          const stat = filtered[idx];
          const cx = IN_L + gridPad + col * (cellW + gap);
          const cy = y;
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          roundRect(ctx, cx, cy, cellW, cellH, 8 * S);
          ctx.fill();
          ctx.fillStyle = getStatColor(stat.value);
          ctx.font = `bold ${Math.round(27 * S)}px Arial, sans-serif`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(stat.value, cx + 14 * S, cy + 12 * S, cellW - 28 * S);
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
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.font = `${stat.hasBuiltInCondition ? 'bold ' : ''}${Math.round(20 * S)}px Arial, sans-serif`;
          let label = stat.label;
          if (stat.isConditional) label += ' (cond)';
          ctx.fillText(label, cx + 14 * S, cy + 50 * S, cellW - 28 * S);
        }
        y += cellH + gap;
      }
      y -= gap;
      y += 6 * S;
    }

    function drawSectionHeader(label: string, cooldown?: string) {
      const barH = 48 * S;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(IN_L, y, IN_W, barH);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(IN_L, y + barH, IN_W, 2);
      ctx.font = `bold ${Math.round(20 * S)}px Arial, sans-serif`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.toUpperCase(), LEFT_X, y + barH / 2);
      if (cooldown) {
        ctx.font = `${Math.round(20 * S)}px Arial, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.textAlign = 'right';
        ctx.fillText(`⏱ ${cooldown}`, IN_R - CONTENT_PAD, y + barH / 2);
      }
      y += barH + 2;
    }

    function drawDescription(desc: string, bgColor: string = 'rgba(0,0,0,0.2)') {
      const clean = stripHtml(desc);
      if (!clean || clean.replace(/[.\s…]+/g, '').length < 3) return;
      ctx.font = `${Math.round(24 * S)}px Arial, sans-serif`;
      const lines = wrapText(ctx, clean, MAX_TEXT_W - 12 * S);
      const lineH = 33 * S;
      const blockH = lines.length * lineH + 24 * S;
      ctx.fillStyle = bgColor;
      ctx.fillRect(IN_L, y, IN_W, blockH);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `${Math.round(24 * S)}px Arial, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], LEFT_X + 4 * S, y + 12 * S + i * lineH, MAX_TEXT_W - 8 * S);
      }
      y += blockH;
    }

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
    if (innateStats.length > 0) drawInnateRows(innateStats);

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

    return { canvas, finalY: y };
  }

  // ── Pass 1: draw to visible-area-height canvas to check if content fits ──
  const { canvas: firstCanvas, finalY } = drawContent(contentAreaPx);

  if (finalY <= contentAreaPx) {
    // Content fits — no scrolling needed
    const texture = new THREE.CanvasTexture(firstCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    (texture as any)._contentHeight = contentAreaPx;
    (texture as any)._contentAreaH = contentAreaPx;
    return texture;
  }

  // ── Pass 2: content overflows — redraw to correctly-sized canvas ──
  const contentH = Math.ceil(finalY + 20 * S);
  const { canvas: tallCanvas } = drawContent(contentH);

  const texture = new THREE.CanvasTexture(tallCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  (texture as any)._contentHeight = contentH;
  (texture as any)._contentAreaH = contentAreaPx;

  // UV: show top portion initially (viewport = contentAreaPx within taller texture)
  texture.repeat.set(1, contentAreaPx / contentH);
  texture.offset.set(0, 1 - contentAreaPx / contentH);

  return texture;
}
