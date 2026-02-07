import { useState, useCallback, useMemo } from 'react';
import { createTextTexture } from './textTexture';
import type { ItemCategory } from '../../types';

const BTN_W = 0.09;
const BTN_H = 0.045;
const BTN_D = 0.008;
const GAP = 0.015;

// Shuffle button color matches active category (like 2D Navigation)
const SHUFFLE_COLORS: Record<string, { bg: string; hover: string; border: string }> = {
  all:      { bg: '#3a3225', hover: '#4a4235', border: '#f7e6cc66' },
  weapon:   { bg: '#3d2a1a', hover: '#4d3a2a', border: '#D4883A88' },
  vitality: { bg: '#1e3320', hover: '#2e4330', border: '#4CAF5088' },
  spirit:   { bg: '#2a2040', hover: '#3a3050', border: '#9C6FDF88' },
};

interface NavControls3DProps {
  currentIndex: number;
  total: number;
  category?: ItemCategory;
  onPrevious: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onReset: () => void;
  onGoToEnd: () => void;
  position?: [number, number, number];
}

function NavBtn({
  label,
  onClick,
  disabled = false,
  position,
  width = BTN_W,
  color = '#2a2a3e',
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  position: [number, number, number];
  width?: number;
  color?: string;
}) {
  const [hovered, setHovered] = useState(false);

  const handleClick = useCallback((e: any) => {
    e.stopPropagation();
    if (!disabled) onClick();
  }, [onClick, disabled]);

  const bgColor = disabled ? '#1a1a25' : (hovered ? '#3a3a55' : color);
  const textColor = disabled ? '#444444' : '#ffffff';

  const labelTex = useMemo(() =>
    createTextTexture(label, {
      width: 128, height: 48, fontSize: 22, fontWeight: 'bold', color: textColor,
    }),
  [label, textColor]);

  return (
    <group position={position}>
      <mesh
        onClick={handleClick}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <boxGeometry args={[width, BTN_H, BTN_D]} />
        <meshBasicMaterial color={bgColor} transparent opacity={disabled ? 0.5 : 0.9} />
      </mesh>
      <mesh position={[0, 0, BTN_D / 2 + 0.001]} renderOrder={1}>
        <planeGeometry args={[width * 0.8, BTN_H * 0.7]} />
        <meshBasicMaterial map={labelTex} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

export function NavControls3D({
  currentIndex,
  total,
  category = 'all',
  onPrevious,
  onNext,
  onShuffle,
  onReset,
  onGoToEnd,
  position = [0, 0.85, -1.2],
}: NavControls3DProps) {
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;

  const shuffleW = BTN_W * 1.2;
  const totalW = BTN_W * 4 + shuffleW + GAP * 4;
  const startX = -totalW / 2;

  const shuffleColor = SHUFFLE_COLORS[category] || SHUFFLE_COLORS.all;

  const progressTex = useMemo(() =>
    createTextTexture(
      total > 0 ? `${currentIndex + 1} / ${total}` : '0 / 0',
      { width: 192, height: 32, fontSize: 18, color: '#aaaaaa' }
    ),
  [currentIndex, total]);

  return (
    <group position={position}>
      {/* Progress text */}
      <mesh position={[0, BTN_H / 2 + 0.025, 0]}>
        <planeGeometry args={[0.14, 0.025]} />
        <meshBasicMaterial map={progressTex} transparent depthWrite={false} />
      </mesh>

      <NavBtn label="|◀" onClick={onReset} disabled={isFirst}
        position={[startX + BTN_W / 2, 0, 0]} />

      <NavBtn label="◀" onClick={onPrevious} disabled={isFirst}
        position={[startX + BTN_W + GAP + BTN_W / 2, 0, 0]} />

      <NavBtn label="Shuffle" onClick={onShuffle}
        position={[startX + BTN_W * 2 + GAP * 2 + shuffleW / 2, 0, 0]}
        width={shuffleW} color={shuffleColor.bg} />

      <NavBtn label="▶" onClick={onNext} disabled={isLast}
        position={[startX + BTN_W * 2 + shuffleW + GAP * 3 + BTN_W / 2, 0, 0]} />

      <NavBtn label="▶|" onClick={onGoToEnd} disabled={isLast}
        position={[startX + BTN_W * 3 + shuffleW + GAP * 4 + BTN_W / 2, 0, 0]} />
    </group>
  );
}
