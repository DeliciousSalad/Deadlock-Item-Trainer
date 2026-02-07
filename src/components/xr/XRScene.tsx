import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { XR } from '@react-three/xr';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { xrStore } from './xrStore';
import { Carousel3D } from './Carousel3D';
import { NavControls3D } from './NavControls3D';
import { FilterPanel3D } from './FilterPanel3D';
import { VolumePanel3D } from './VolumePanel3D';
import { updateAudioListenerFromCamera } from '../../utils/sounds';
import type { ProcessedItem, ItemCategory } from '../../types';
import type { SortOption } from '../FilterBar';

/**
 * Wrapper that samples the XR camera's Y position and positions its children
 * so that Y=0 in child space = the user's eye level.
 * Keeps sampling until a stable reading is found, then smoothly locks on.
 */
function EyeLevelGroup({ children }: { children: ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const eyeY = useRef<number | null>(null);
  const settled = useRef(false);
  const samples = useRef<number[]>([]);
  const frameCount = useRef(0);
  const [visible, setVisible] = useState(false);

  useFrame(() => {
    frameCount.current++;
    const camY = camera.position.y;

    if (!settled.current) {
      // Keep collecting valid samples until we have enough for a stable average
      if (camY > 0.1) {
        samples.current.push(camY);

        // Need at least 5 valid samples, and at least 10 frames have passed
        // (gives XR session time to initialize)
        if (samples.current.length >= 5 && frameCount.current >= 10) {
          // Use median to reject outliers
          const sorted = [...samples.current].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          eyeY.current = sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;
          settled.current = true;
          setVisible(true);
        }
      }

      // Safety: if after 300 frames we still don't have a reading,
      // accept any valid sample we've collected
      if (!settled.current && frameCount.current >= 300 && samples.current.length > 0) {
        eyeY.current = samples.current[samples.current.length - 1];
        settled.current = true;
        setVisible(true);
      }
    }

    // Apply position
    if (groupRef.current && eyeY.current !== null) {
      groupRef.current.position.y = eyeY.current;
    }
  });

  return <group ref={groupRef} visible={visible}>{children}</group>;
}

/**
 * Syncs the Web Audio API listener to the XR camera every frame
 * so spatial sounds are positioned correctly relative to the headset.
 */
const _forward = new THREE.Vector3();
const _up = new THREE.Vector3();

function AudioListenerSync() {
  const { camera } = useThree();

  useFrame(() => {
    camera.getWorldDirection(_forward);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    updateAudioListenerFromCamera(
      camera.position,
      _forward,
      _up,
    );
  });

  return null;
}

const EXIT_TYPE_THEME: Record<string, { grad0: string; grad1: string; border: string }> = {
  all:      { grad0: '#dc2626', grad1: '#ef4444', border: '#f87171' },
  weapon:   { grad0: '#92400e', grad1: '#b45309', border: '#d97706' },
  vitality: { grad0: '#065f46', grad1: '#047857', border: '#10b981' },
  spirit:   { grad0: '#5b21b6', grad1: '#6d28d9', border: '#8b5cf6' },
};

function ExitXRButton({ position, category = 'all' }: { position: [number, number, number]; category?: ItemCategory }) {
  const [hovered, setHovered] = useState(false);

  const theme = EXIT_TYPE_THEME[category] || EXIT_TYPE_THEME.all;

  // Canvas-rendered pill button with icon + text
  const btnTex = useMemo(() => {
    const w = 160;
    const h = 48;
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d')!;
    const s = 2; // retina scale

    // Rounded rect background
    const r = 12 * s;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w * s - r, 0);
    ctx.quadraticCurveTo(w * s, 0, w * s, r);
    ctx.lineTo(w * s, h * s - r);
    ctx.quadraticCurveTo(w * s, h * s, w * s - r, h * s);
    ctx.lineTo(r, h * s);
    ctx.quadraticCurveTo(0, h * s, 0, h * s - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, w * s, h * s);
    grad.addColorStop(0, theme.grad0);
    grad.addColorStop(1, theme.grad1);
    ctx.fillStyle = grad;
    ctx.fill();

    // Border
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 2 * s;
    ctx.stroke();

    // X icon (left side)
    const iconX = 22 * s;
    const iconY = h * s / 2;
    const iconR = 8 * s;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(iconX - iconR, iconY - iconR);
    ctx.lineTo(iconX + iconR, iconY + iconR);
    ctx.moveTo(iconX + iconR, iconY - iconR);
    ctx.lineTo(iconX - iconR, iconY + iconR);
    ctx.stroke();

    // "Exit XR" text
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${16 * s}px Arial, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('Exit XR', 40 * s, h * s / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [theme]);

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    const session = xrStore.getState().session;
    if (session) session.end();
  }, []);

  const btnW = 0.12;
  const btnH = 0.038;

  return (
    <group position={position}>
      <mesh
        onClick={handleClick}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        scale={hovered ? [1.05, 1.05, 1] : [1, 1, 1]}
        renderOrder={1}
      >
        <planeGeometry args={[btnW, btnH]} />
        <meshBasicMaterial map={btnTex} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ─── Dark translucent backdrop panel ──────────────────────────── */

function Backdrop3D({ position, width, height }: {
  position: [number, number, number];
  width: number;
  height: number;
}) {
  const tex = useMemo(() => {
    const PX_W = 512;
    const PX_H = Math.round(PX_W * (height / width));
    const S = 2;
    const canvas = document.createElement('canvas');
    canvas.width = PX_W * S;
    canvas.height = PX_H * S;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(S, S);

    // Rounded rectangle
    const r = 18;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(PX_W - r, 0);
    ctx.quadraticCurveTo(PX_W, 0, PX_W, r);
    ctx.lineTo(PX_W, PX_H - r);
    ctx.quadraticCurveTo(PX_W, PX_H, PX_W - r, PX_H);
    ctx.lineTo(r, PX_H);
    ctx.quadraticCurveTo(0, PX_H, 0, PX_H - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();

    ctx.fillStyle = 'rgba(5, 5, 15, 0.45)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [width, height]);

  return (
    <mesh position={position} renderOrder={-2}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
}

/* ─── Logo header (matches 2D header) ──────────────────────────── */

function LogoHeader3D({ position, itemCount, patchDate }: {
  position: [number, number, number];
  itemCount: number;
  patchDate?: string | null;
}) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);

  useMemo(() => {
    const W = 600;
    const H = 180;
    const S = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(S, S);

    const base = import.meta.env.BASE_URL;
    const markImg = new Image();
    const wordImg = new Image();
    let loaded = 0;

    const draw = () => {
      ctx.clearRect(0, 0, W, H);

      // Logo mark
      const markH = 52;
      const markW = (markImg.naturalWidth / markImg.naturalHeight) * markH || markH;
      // Word mark
      const wordH = 36;
      const wordW = (wordImg.naturalWidth / wordImg.naturalHeight) * wordH || 110;

      const totalLogoW = markW + 10 + wordW;
      const logoX = (W - totalLogoW) / 2;
      const logoY = 10;

      ctx.filter = 'brightness(0.94) sepia(0.15)';
      ctx.drawImage(markImg, logoX, logoY, markW, markH);
      ctx.drawImage(wordImg, logoX + markW + 10, logoY + (markH - wordH) / 2, wordW, wordH);
      ctx.filter = 'none';

      // "Item Trainer" text
      ctx.fillStyle = '#fae9d0';
      ctx.font = 'bold 26px Georgia, "Times New Roman", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Item Trainer', W / 2, logoY + markH + 14);

      // Item count + patch
      const countText = `${itemCount} items${patchDate ? ` • Patch ${patchDate}` : ''}`;
      ctx.fillStyle = 'rgba(45, 212, 191, 0.6)';
      ctx.font = '15px Arial, sans-serif';
      ctx.fillText(countText, W / 2, logoY + markH + 48);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      setTex(texture);
    };

    const onLoad = () => { if (++loaded === 2) draw(); };
    markImg.onload = onLoad;
    wordImg.onload = onLoad;
    markImg.src = `${base}images/logo_deadlock_mark_only_png.png`;
    wordImg.src = `${base}images/logo_deadlock_word_only_png.png`;
  }, [itemCount, patchDate]);

  if (!tex) return null;

  // 3D plane size: W/H ratio = 600/180 = 3.33
  const planeW = 0.9;
  const planeH = 0.27;

  return (
    <group position={position}>
      <mesh renderOrder={1}>
        <planeGeometry args={[planeW, planeH]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ─── Disclaimer footer (matches 2D footer) ───────────────────── */

// Hit-test regions in normalized UV space (0-1, origin bottom-left)
const FOOTER_W = 600;
const FOOTER_H = 100;
const FOOTER_LINKS = {
  salad:  { label: 'DeliciousSalad', url: 'https://x.com/salad_vr',    uvX: [0.42, 0.72] as const, uvY: [0.68, 0.88] as const },
  api:    { label: 'Deadlock API',   url: 'https://deadlock-api.com',   uvX: [0.40, 0.64] as const, uvY: [0.35, 0.55] as const },
};

function DisclaimerFooter3D({ position }: { position: [number, number, number] }) {
  const [tex, setTex] = useState<THREE.CanvasTexture | null>(null);

  useMemo(() => {
    const W = FOOTER_W;
    const H = FOOTER_H;
    const S = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(S, S);

    const base = import.meta.env.BASE_URL;
    const saladImg = new Image();

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Line 1: "Made by [logo] DeliciousSalad"
      const line1Y = 18;
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px Arial, sans-serif';
      const madeByW = ctx.measureText('Made by ').width;
      const saladTextW = ctx.measureText('DeliciousSalad').width;
      const logoH = 16;
      const logoW = saladImg.naturalWidth ? (saladImg.naturalWidth / saladImg.naturalHeight) * logoH : 16;
      const line1TotalW = madeByW + logoW + 5 + saladTextW;
      const line1X = (W - line1TotalW) / 2;

      ctx.textAlign = 'left';
      ctx.fillText('Made by ', line1X, line1Y);
      ctx.drawImage(saladImg, line1X + madeByW, line1Y - logoH / 2, logoW, logoH);
      ctx.fillStyle = '#32A90D';
      ctx.font = 'bold 14px Arial, sans-serif';
      ctx.fillText('DeliciousSalad', line1X + madeByW + logoW + 5, line1Y);

      // Line 2: "Data from Deadlock API"
      const line2Y = 44;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#6b7280';
      ctx.font = '13px Arial, sans-serif';
      const dataFromW = ctx.measureText('Data from ').width;
      ctx.textAlign = 'left';
      const line2TotalW = dataFromW + ctx.measureText('Deadlock API').width;
      const line2X = (W - line2TotalW) / 2;
      ctx.fillText('Data from ', line2X, line2Y);
      ctx.fillStyle = '#5eead4';
      ctx.font = 'bold 13px Arial, sans-serif';
      ctx.fillText('Deadlock API', line2X + dataFromW, line2Y);

      // Line 3: "Not affiliated with Valve Corporation"
      const line3Y = 70;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px Arial, sans-serif';
      ctx.fillText('Not affiliated with Valve Corporation', W / 2, line3Y);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      setTex(texture);
    };

    saladImg.onload = draw;
    saladImg.onerror = draw; // still render text if logo fails
    saladImg.src = `${base}images/salad_logo_small.png`;
  }, []);

  const handleClick = useCallback((e: any) => {
    if (!e.uv) return;
    const u = e.uv.x;
    const v = e.uv.y;
    for (const link of Object.values(FOOTER_LINKS)) {
      if (u >= link.uvX[0] && u <= link.uvX[1] && v >= link.uvY[0] && v <= link.uvY[1]) {
        window.open(link.url, '_blank');
        return;
      }
    }
  }, []);

  if (!tex) return null;

  // 3D plane: W/H ratio = 600/100 = 6
  const planeW = 0.9;
  const planeH = 0.15;

  return (
    <group position={position}>
      <mesh renderOrder={1} onClick={handleClick}>
        <planeGeometry args={[planeW, planeH]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

interface XRSceneProps {
  active: boolean;
  items: ProcessedItem[];
  totalItemCount: number;
  currentIndex: number;
  flippedIndex: number | null;
  category: ItemCategory;
  tier: number | null;
  sort: SortOption;
  patchDate?: string | null;
  onFlip: (index: number) => void;
  onIndexChange: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onReset: () => void;
  onGoToEnd: () => void;
  onCategoryChange: (category: ItemCategory) => void;
  onTierChange: (tier: number | null) => void;
  onSortChange: (sort: SortOption) => void;
}

export function XRScene({
  active,
  items,
  totalItemCount,
  currentIndex,
  flippedIndex,
  category,
  tier,
  sort,
  patchDate,
  onFlip,
  onIndexChange,
  onPrevious,
  onNext,
  onShuffle,
  onReset,
  onGoToEnd,
  onCategoryChange,
  onTierChange,
  onSortChange,
}: XRSceneProps) {
  const handleFlip = useCallback((index: number) => {
    onFlip(index);
  }, [onFlip]);

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      opacity: 0,
      pointerEvents: 'none',
    }}>
      <Canvas>
        <XR store={xrStore}>
          {/* Only render 3D content when XR session is active — avoids
              loading textures and running useFrame loops in 2D mode */}
          {active && (
            <>
              <ambientLight intensity={1.5} />
              <directionalLight position={[2, 4, 3]} intensity={2} />
              <AudioListenerSync />

              <EyeLevelGroup>
                {/* All positions are relative to eye level: 0 = eyes */}

                {/* Dark backdrop behind top UI (logo, exit, volume, filters) */}
                <Backdrop3D position={[0, 0.45, -0.91]} width={1.25} height={0.32} />

                {/* Dark backdrop behind bottom UI (nav controls, footer) */}
                <Backdrop3D position={[0, -0.48, -0.91]} width={1.0} height={0.30} />

                <Carousel3D
                  items={items}
                  currentIndex={currentIndex}
                  flippedIndex={flippedIndex}
                  onIndexChange={onIndexChange}
                  onFlip={handleFlip}
                  position={[0, 0, 0.6]}
                />

                <NavControls3D
                  currentIndex={currentIndex}
                  total={items.length}
                  category={category}
                  onPrevious={onPrevious}
                  onNext={onNext}
                  onShuffle={onShuffle}
                  onReset={onReset}
                  onGoToEnd={onGoToEnd}
                  position={[0, -0.4, -0.9]}
                />

                <FilterPanel3D
                  category={category}
                  tier={tier}
                  sort={sort}
                  onCategoryChange={onCategoryChange}
                  onTierChange={onTierChange}
                  onSortChange={onSortChange}
                  position={[0, 0.35, -0.9]}
                />

                <VolumePanel3D position={[0.4, 0.47, -0.9]} />

                <ExitXRButton position={[-0.4, 0.42, -0.9]} category={category} />

                <LogoHeader3D
                  position={[0, 0.45, -0.9]}
                  itemCount={totalItemCount}
                  patchDate={patchDate}
                />

                <DisclaimerFooter3D position={[0, -0.55, -0.9]} />
              </EyeLevelGroup>
            </>
          )}
        </XR>
      </Canvas>
    </div>
  );
}
