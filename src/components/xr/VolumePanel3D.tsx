import { useState, useCallback, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getMusicVolume, setMusicVolume, getSfxVolume, setSfxVolume } from '../../utils/volume';

/* ─── Dimensions (3D world units) ───────────────────────────────── */

const PANEL_W = 0.34;
const PANEL_H = 0.14;

const TRACK_W = 0.17;
const TRACK_H = 0.012;

const THUMB_R = 0.012;

/* ─── Canvas helpers ────────────────────────────────────────────── */

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
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

function createPanelTexture(): THREE.CanvasTexture {
  const W = 540;
  const H = 220;
  const S = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(S, S);

  // Rounded rect background with subtle border
  const r = 16;
  roundRect(ctx, 0, 0, W, H, r);
  ctx.fillStyle = 'rgba(8, 8, 20, 0.85)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Title
  ctx.fillStyle = '#9ca3af';
  ctx.font = 'bold 22px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Volume', W / 2, 30);

  // Divider line under title
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(24, 52);
  ctx.lineTo(W - 24, 52);
  ctx.stroke();

  // Row labels
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  // Music label — drawn music note icon + text
  const musicColor = '#e8a849';
  ctx.save();
  ctx.strokeStyle = musicColor;
  ctx.fillStyle = musicColor;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Note circle
  ctx.beginPath();
  ctx.arc(35, 99, 6, 0, Math.PI * 2);
  ctx.fill();
  // Stem
  ctx.beginPath();
  ctx.moveTo(41, 99);
  ctx.lineTo(41, 75);
  ctx.stroke();
  // Flag
  ctx.beginPath();
  ctx.moveTo(41, 75);
  ctx.lineTo(51, 79);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = musicColor;
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.fillText('Music', 60, 92);

  // SFX label — drawn speaker icon + text
  const sfxColor = '#5eead4';
  ctx.save();
  ctx.strokeStyle = sfxColor;
  ctx.fillStyle = sfxColor;
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Speaker body
  ctx.beginPath();
  ctx.moveTo(38, 153);
  ctx.lineTo(33, 156);
  ctx.lineTo(27, 156);
  ctx.lineTo(27, 164);
  ctx.lineTo(33, 164);
  ctx.lineTo(38, 167);
  ctx.closePath();
  ctx.fill();
  // Sound wave arcs
  ctx.beginPath();
  ctx.arc(40, 160, 6, -Math.PI * 0.35, Math.PI * 0.35);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(40, 160, 11, -Math.PI * 0.35, Math.PI * 0.35);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = sfxColor;
  ctx.font = 'bold 20px Arial, sans-serif';
  ctx.fillText('SFX', 60, 160);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/* ─── Slider row component ──────────────────────────────────────── */

interface SliderRowProps {
  color: string;
  value: number;
  onChange: (v: number) => void;
  yOffset: number;
}

function SliderRow({ color, value, onChange, yOffset }: SliderRowProps) {
  const draggingRef = useRef(false);
  const [hovered, setHovered] = useState(false);
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<THREE.Mesh>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const thumbRef = useRef<THREE.Mesh>(null);

  // Track + fill colors
  const trackColor = useMemo(() => new THREE.Color('#1f2937'), []);
  const fillColor = useMemo(() => new THREE.Color(color), [color]);
  const thumbColor = useMemo(() => new THREE.Color('#ffffff'), []);

  // Update fill bar and thumb position each frame
  useFrame(() => {
    if (fillRef.current) {
      const fillW = Math.max(TRACK_W * value, 0.001);
      fillRef.current.scale.x = fillW / TRACK_W;
      fillRef.current.position.x = -TRACK_W / 2 + fillW / 2;
    }
    if (thumbRef.current) {
      thumbRef.current.position.x = -TRACK_W / 2 + TRACK_W * value;
      const targetScale = (hovered || draggingRef.current) ? 1.4 : 1.0;
      thumbRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, 1), 0.2);
    }
  });

  const computeValue = useCallback((e: any) => {
    if (!trackRef.current) return null;
    const local = trackRef.current.worldToLocal(e.point.clone());
    return Math.max(0, Math.min(1, (local.x + TRACK_W / 2) / TRACK_W));
  }, []);

  const handlePointerDown = useCallback((e: any) => {
    e.stopPropagation();
    draggingRef.current = true;
    setDragging(true);
    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    const v = computeValue(e);
    if (v !== null) onChange(Math.round(v * 20) / 20);
  }, [onChange, computeValue]);

  const handlePointerMove = useCallback((e: any) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    const v = computeValue(e);
    if (v !== null) onChange(Math.round(v * 20) / 20);
  }, [onChange, computeValue]);

  const handlePointerUp = useCallback((e: any) => {
    e.stopPropagation();
    draggingRef.current = false;
    setDragging(false);
    (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
  }, []);

  // Wider invisible hit area for easier interaction
  const hitW = TRACK_W + 0.03;
  const hitH = 0.038;

  return (
    <group position={[0.03, yOffset, 0]}>
      {/* Invisible hit area */}
      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => { setHovered(false); }}
        renderOrder={5}
      >
        <planeGeometry args={[hitW, hitH]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Track background */}
      <mesh ref={trackRef} renderOrder={2}>
        <planeGeometry args={[TRACK_W, TRACK_H]} />
        <meshBasicMaterial color={trackColor} transparent opacity={0.9} depthWrite={false} />
      </mesh>

      {/* Track border */}
      <mesh renderOrder={1} position={[0, 0, -0.0001]}>
        <planeGeometry args={[TRACK_W + 0.003, TRACK_H + 0.003]} />
        <meshBasicMaterial color="#374151" transparent opacity={0.5} depthWrite={false} />
      </mesh>

      {/* Fill bar */}
      <mesh ref={fillRef} position={[-TRACK_W / 2 + (TRACK_W * value) / 2, 0, 0.001]} renderOrder={3}>
        <planeGeometry args={[TRACK_W, TRACK_H]} />
        <meshBasicMaterial color={fillColor} transparent opacity={0.85} depthWrite={false} />
      </mesh>

      {/* Thumb */}
      <mesh
        ref={thumbRef}
        position={[-TRACK_W / 2 + TRACK_W * value, 0, 0.002]}
        renderOrder={4}
      >
        <circleGeometry args={[THUMB_R, 24]} />
        <meshBasicMaterial color={thumbColor} transparent opacity={0.95} depthWrite={false} />
      </mesh>

      {/* Thumb glow ring when hovered/dragging */}
      {(hovered || dragging) && (
        <mesh
          position={[-TRACK_W / 2 + TRACK_W * value, 0, 0.0015]}
          renderOrder={3}
        >
          <circleGeometry args={[THUMB_R * 1.8, 24]} />
          <meshBasicMaterial color={fillColor} transparent opacity={0.2} depthWrite={false} />
        </mesh>
      )}

      {/* Value percentage label */}
      <PercentLabel value={value} x={TRACK_W / 2 + 0.028} y={0} />
    </group>
  );
}

/* ─── Percentage label (canvas texture) ─────────────────────────── */

function PercentLabel({ value, x, y }: { value: number; x: number; y: number }) {
  const tex = useMemo(() => {
    const W = 80;
    const H = 32;
    const S = 2;
    const canvas = document.createElement('canvas');
    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(S, S);
    ctx.fillStyle = '#d1d5db';
    ctx.font = 'bold 16px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(value * 100)}%`, W / 2, H / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }, [value]);

  return (
    <mesh position={[x, y, 0.001]} renderOrder={4}>
      <planeGeometry args={[0.038, 0.016]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  );
}

/* ─── Main panel ────────────────────────────────────────────────── */

interface VolumePanel3DProps {
  position?: [number, number, number];
  rotation?: [number, number, number];
}

export function VolumePanel3D({
  position = [0, 0.42, -0.9],
  rotation,
}: VolumePanel3DProps) {
  const [musicVol, setMusicVol] = useState(() => getMusicVolume());
  const [sfxVol, setSfxVol] = useState(() => getSfxVolume());

  const handleMusicChange = useCallback((v: number) => {
    setMusicVol(v);
    setMusicVolume(v);
  }, []);

  const handleSfxChange = useCallback((v: number) => {
    setSfxVol(v);
    setSfxVolume(v);
  }, []);

  const panelTex = useMemo(() => createPanelTexture(), []);

  return (
    <group position={position} rotation={rotation}>
      {/* Panel background with rounded corners, labels, and title baked in */}
      <mesh renderOrder={0}>
        <planeGeometry args={[PANEL_W, PANEL_H]} />
        <meshBasicMaterial map={panelTex} transparent depthWrite={false} />
      </mesh>

      {/* Music slider */}
      <SliderRow
        color="#e8a849"
        value={musicVol}
        onChange={handleMusicChange}
        yOffset={0.014}
      />

      {/* SFX slider */}
      <SliderRow
        color="#5eead4"
        value={sfxVol}
        onChange={handleSfxChange}
        yOffset={-0.032}
      />
    </group>
  );
}
