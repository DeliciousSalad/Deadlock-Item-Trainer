import { useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import { playSpatialCategorySound } from '../../utils/sounds';
import type { ItemCategory } from '../../types';
import type { SortOption } from '../FilterBar';

/* ════════════════════════════════════════════════════
   Canvas helpers — render rounded-rect buttons/panels
   so the 3D filter bar looks like the 2D one.
   ════════════════════════════════════════════════════ */

const TEX_SCALE = 2; // resolution multiplier

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

/** Draw a single rounded-rect button with text on a canvas and return a texture */
function createBtnTexture(
  label: string,
  opts: {
    w: number;
    h: number;
    bg: string;
    textColor: string;
    borderColor?: string;
    fontSize?: number;
    fontWeight?: string;
  },
): THREE.CanvasTexture {
  const { w, h, bg, textColor, borderColor, fontSize = 13, fontWeight = 'bold' } = opts;
  const cw = Math.round(w * TEX_SCALE);
  const ch = Math.round(h * TEX_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  const r = 6 * TEX_SCALE;

  // Background
  roundRect(ctx, 0, 0, cw, ch, r);
  ctx.fillStyle = bg;
  ctx.fill();

  // Border
  if (borderColor) {
    roundRect(ctx, 0, 0, cw, ch, r);
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1.5 * TEX_SCALE;
    ctx.stroke();
  }

  // Text
  ctx.fillStyle = textColor;
  ctx.font = `${fontWeight} ${fontSize * TEX_SCALE}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cw / 2, ch / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Draw a group background (dark rounded rect like bg-black/30 rounded-lg) */
function createGroupBgTexture(w: number, h: number): THREE.CanvasTexture {
  const cw = Math.round(w * TEX_SCALE);
  const ch = Math.round(h * TEX_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  const r = 8 * TEX_SCALE;

  roundRect(ctx, 0, 0, cw, ch, r);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* ════════════════════════════════════════════════════
   3D Button component with canvas-rendered texture
   ════════════════════════════════════════════════════ */

// Colors matching 2D FilterBar
const CAT_STYLES: Record<string, {
  activeBg: string; activeText: string; activeBorder: string;
  inactiveText: string; hoverBg: string;
}> = {
  all:      { activeBg: 'rgba(255,255,255,0.20)', activeText: '#ffffff', activeBorder: '',                  inactiveText: '#999999', hoverBg: 'rgba(255,255,255,0.10)' },
  weapon:   { activeBg: 'rgba(245,158,11,0.30)',  activeText: '#fcd34d', activeBorder: 'rgba(245,158,11,0.6)', inactiveText: '#D4883A', hoverBg: 'rgba(245,158,11,0.15)' },
  vitality: { activeBg: 'rgba(16,185,129,0.30)',  activeText: '#6ee7b7', activeBorder: 'rgba(16,185,129,0.6)', inactiveText: '#4CAF50', hoverBg: 'rgba(16,185,129,0.15)' },
  spirit:   { activeBg: 'rgba(139,92,246,0.30)',  activeText: '#c4b5fd', activeBorder: 'rgba(139,92,246,0.6)', inactiveText: '#9C6FDF', hoverBg: 'rgba(139,92,246,0.15)' },
};

const NEUTRAL_ACTIVE_BG = 'rgba(255,255,255,0.20)';
const NEUTRAL_ACTIVE_TEXT = '#ffffff';
const NEUTRAL_INACTIVE_TEXT = '#999999';
const NEUTRAL_HOVER_BG = 'rgba(255,255,255,0.10)';
const DISABLED_TEXT = '#444444';

// Pixel sizes for canvas rendering
const PX_BTN_W = 64;
const PX_BTN_W_WIDE = 82;
const PX_BTN_H = 34;
const PX_TIER_W = 36;
const PX_SORT_W = 72;

// 3D sizes (world units)
const S = 0.001; // pixels to world units scale
const BTN_GAP = 0.002;
const SECTION_GAP = 0.008;
const LABEL_OFFSET = 0.003;

function FilterBtn({
  label,
  isActive,
  onClick,
  position,
  width3d,
  bg,
  textColor,
  hoverBg,
  borderColor,
  disabled = false,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  position: [number, number, number];
  width3d: number;
  bg: string;
  textColor: string;
  hoverBg: string;
  borderColor?: string;
  disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    if (!disabled) onClick();
  }, [onClick, disabled]);

  const currentBg = disabled ? 'transparent' : (hovered && !isActive ? hoverBg : bg);
  const currentText = disabled ? DISABLED_TEXT : textColor;
  const currentBorder = isActive ? borderColor : undefined;

  const tex = useMemo(() =>
    createBtnTexture(label, {
      w: Math.round(width3d / S),
      h: PX_BTN_H,
      bg: currentBg,
      textColor: currentText,
      borderColor: currentBorder,
      fontSize: 14,
      fontWeight: 'bold',
    }),
  [label, width3d, currentBg, currentText, currentBorder, isActive]);

  const h3d = PX_BTN_H * S;

  return (
    <group position={position}>
      <mesh
        onClick={handleClick}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        renderOrder={2}
      >
        <planeGeometry args={[width3d, h3d]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ════════════════════════════════════════════════════
   Main FilterPanel3D — horizontal strip
   ════════════════════════════════════════════════════ */

interface FilterPanel3DProps {
  category: ItemCategory;
  tier: number | null;
  sort: SortOption;
  onCategoryChange: (cat: ItemCategory) => void;
  onTierChange: (tier: number | null) => void;
  onSortChange: (sort: SortOption) => void;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export function FilterPanel3D({
  category,
  tier,
  sort,
  onCategoryChange,
  onTierChange,
  onSortChange,
  position = [0, 0.35, -0.9],
  rotation = [0, 0, 0],
}: FilterPanel3DProps) {
  const categories: { key: ItemCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'weapon', label: 'Weapon' },
    { key: 'vitality', label: 'Vitality' },
    { key: 'spirit', label: 'Spirit' },
  ];

  const tiers = [
    { key: null as number | null, label: 'All' },
    { key: 1, label: '1' },
    { key: 2, label: '2' },
    { key: 3, label: '3' },
    { key: 4, label: '4' },
    { key: 5, label: '5' },
  ];

  const sortOptions: { key: SortOption; label: string }[] = [
    { key: 'default', label: 'Default' },
    { key: 'name', label: 'A-Z' },
    { key: 'type', label: 'Type' },
    { key: 'tier', label: 'Tier' },
  ];

  const isTypeDisabled = category !== 'all';
  const isTierDisabled = tier !== null;

  // ── Compute layout ──
  const btnH = PX_BTN_H * S;
  const catBtnW = PX_BTN_W * S;
  const catBtnWide = PX_BTN_W_WIDE * S;
  const tierBtnW = PX_TIER_W * S;
  const tierAllW = PX_BTN_W * S;
  const sortBtnW = PX_SORT_W * S;

  // Section label textures
  const typeLabelTex = useMemo(() =>
    createBtnTexture('Type:', { w: 48, h: PX_BTN_H, bg: 'transparent', textColor: '#777777', fontSize: 13, fontWeight: 'bold' }),
  []);
  const tierLabelTex = useMemo(() =>
    createBtnTexture('Tier:', { w: 44, h: PX_BTN_H, bg: 'transparent', textColor: '#777777', fontSize: 13, fontWeight: 'bold' }),
  []);
  const sortLabelTex = useMemo(() =>
    createBtnTexture('Sort:', { w: 44, h: PX_BTN_H, bg: 'transparent', textColor: '#777777', fontSize: 13, fontWeight: 'bold' }),
  []);

  const labelW = 0.042;
  const tierLabelW = 0.038;

  // ── Build X positions for 3 groups ──
  // Group 1: Type
  const catWidths = categories.map(c => (c.key === 'vitality' || c.key === 'spirit') ? catBtnWide : catBtnW);
  const grp1InnerW = LABEL_OFFSET + labelW + catWidths.reduce((s, w) => s + w + BTN_GAP, 0) - BTN_GAP + LABEL_OFFSET;

  // Group 2: Tier
  const tierWidths = tiers.map((_, i) => i === 0 ? tierAllW : tierBtnW);
  const grp2InnerW = LABEL_OFFSET + tierLabelW + tierWidths.reduce((s, w) => s + w + BTN_GAP, 0) - BTN_GAP + LABEL_OFFSET;

  // Group 3: Sort
  const grp3InnerW = LABEL_OFFSET + tierLabelW + sortOptions.length * (sortBtnW + BTN_GAP) - BTN_GAP + LABEL_OFFSET;

  const totalW = grp1InnerW + SECTION_GAP + grp2InnerW + SECTION_GAP + grp3InnerW;
  const startX = -totalW / 2;

  // Group background textures
  const grp1BgTex = useMemo(() => createGroupBgTexture(Math.round(grp1InnerW / S), Math.round((btnH + 0.008) / S)), [grp1InnerW, btnH]);
  const grp2BgTex = useMemo(() => createGroupBgTexture(Math.round(grp2InnerW / S), Math.round((btnH + 0.008) / S)), [grp2InnerW, btnH]);
  const grp3BgTex = useMemo(() => createGroupBgTexture(Math.round(grp3InnerW / S), Math.round((btnH + 0.008) / S)), [grp3InnerW, btnH]);

  const grpH = btnH + 0.008;

  // ── Group 1 positions ──
  let x = startX;
  const grp1X = x + grp1InnerW / 2;
  const typeLabelPos = x + LABEL_OFFSET + labelW / 2;
  x += LABEL_OFFSET + labelW;
  const catPos = catWidths.map((w) => {
    const p = x + w / 2;
    x += w + BTN_GAP;
    return p;
  });
  x = startX + grp1InnerW + SECTION_GAP;

  // ── Group 2 positions ──
  const grp2X = x + grp2InnerW / 2;
  const tierLabelPos = x + LABEL_OFFSET + tierLabelW / 2;
  x += LABEL_OFFSET + tierLabelW;
  const tierPos = tierWidths.map((w) => {
    const p = x + w / 2;
    x += w + BTN_GAP;
    return p;
  });
  x = startX + grp1InnerW + SECTION_GAP + grp2InnerW + SECTION_GAP;

  // ── Group 3 positions ──
  const grp3X = x + grp3InnerW / 2;
  const sortLabelPos = x + LABEL_OFFSET + tierLabelW / 2;
  x += LABEL_OFFSET + tierLabelW;
  const sortPos = sortOptions.map(() => {
    const p = x + sortBtnW / 2;
    x += sortBtnW + BTN_GAP;
    return p;
  });

  return (
    <group position={position} rotation={rotation}>
      {/* ── Group backgrounds ── */}
      <mesh position={[grp1X, 0, -0.001]} renderOrder={0}>
        <planeGeometry args={[grp1InnerW, grpH]} />
        <meshBasicMaterial map={grp1BgTex} transparent depthWrite={false} />
      </mesh>
      <mesh position={[grp2X, 0, -0.001]} renderOrder={0}>
        <planeGeometry args={[grp2InnerW, grpH]} />
        <meshBasicMaterial map={grp2BgTex} transparent depthWrite={false} />
      </mesh>
      <mesh position={[grp3X, 0, -0.001]} renderOrder={0}>
        <planeGeometry args={[grp3InnerW, grpH]} />
        <meshBasicMaterial map={grp3BgTex} transparent depthWrite={false} />
      </mesh>

      {/* ── TYPE section ── */}
      <mesh position={[typeLabelPos, 0, 0.001]} renderOrder={1}>
        <planeGeometry args={[labelW, btnH]} />
        <meshBasicMaterial map={typeLabelTex} transparent depthWrite={false} />
      </mesh>
      {categories.map((cat, i) => {
        const style = CAT_STYLES[cat.key];
        const active = category === cat.key;
        return (
          <FilterBtn
            key={cat.key}
            label={cat.label}
            isActive={active}
            onClick={() => {
              if (cat.key !== category) {
                playSpatialCategorySound(cat.key, position as [number, number, number]);
              }
              onCategoryChange(cat.key);
            }}
            position={[catPos[i], 0, 0.001]}
            width3d={catWidths[i]}
            bg={active ? style.activeBg : 'transparent'}
            textColor={active ? style.activeText : style.inactiveText}
            hoverBg={style.hoverBg}
            borderColor={style.activeBorder}
          />
        );
      })}

      {/* ── TIER section ── */}
      <mesh position={[tierLabelPos, 0, 0.001]} renderOrder={1}>
        <planeGeometry args={[tierLabelW, btnH]} />
        <meshBasicMaterial map={tierLabelTex} transparent depthWrite={false} />
      </mesh>
      {tiers.map((t, i) => {
        const active = tier === t.key;
        return (
          <FilterBtn
            key={`tier-${t.key}`}
            label={t.label}
            isActive={active}
            onClick={() => onTierChange(t.key)}
            position={[tierPos[i], 0, 0.001]}
            width3d={tierWidths[i]}
            bg={active ? NEUTRAL_ACTIVE_BG : 'transparent'}
            textColor={active ? NEUTRAL_ACTIVE_TEXT : NEUTRAL_INACTIVE_TEXT}
            hoverBg={NEUTRAL_HOVER_BG}
          />
        );
      })}

      {/* ── SORT section ── */}
      <mesh position={[sortLabelPos, 0, 0.001]} renderOrder={1}>
        <planeGeometry args={[tierLabelW, btnH]} />
        <meshBasicMaterial map={sortLabelTex} transparent depthWrite={false} />
      </mesh>
      {sortOptions.map((s, i) => {
        const active = sort === s.key;
        const isDisabled =
          (s.key === 'type' && isTypeDisabled) ||
          (s.key === 'tier' && isTierDisabled);
        return (
          <FilterBtn
            key={s.key}
            label={s.label}
            isActive={active}
            onClick={() => onSortChange(s.key)}
            position={[sortPos[i], 0, 0.001]}
            width3d={sortBtnW}
            bg={active ? NEUTRAL_ACTIVE_BG : 'transparent'}
            textColor={active ? NEUTRAL_ACTIVE_TEXT : NEUTRAL_INACTIVE_TEXT}
            hoverBg={NEUTRAL_HOVER_BG}
            disabled={isDisabled}
          />
        );
      })}
    </group>
  );
}
