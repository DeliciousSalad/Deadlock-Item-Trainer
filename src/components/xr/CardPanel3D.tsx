import { useRef, useMemo, useState, useEffect, memo, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ProcessedItem } from '../../types';
import { createFrontTexture, createBackTexture } from './cardTextures';

const CDN_ORIGIN = 'https://assets-bucket.deadlock-api.com';

function proxyImageUrl(url: string): string {
  if (url.startsWith(CDN_ORIGIN)) {
    return '/_img-proxy' + url.slice(CDN_ORIGIN.length);
  }
  return url;
}

export const CARD_W = 0.35;
export const CARD_H = 0.5;
export const ARC_RADIUS = 1.5;
export const ARC_STEP = 0.255; // radians between cards
const CARD_Y = 0;
const HALF_VISIBLE = 3; // cards visible on each side of center

// ── Global texture cache keyed by item id + image state ──
const textureCache = new Map<string, { front: THREE.CanvasTexture; back: THREE.CanvasTexture }>();

interface CardPanel3DProps {
  item: ProcessedItem;
  itemIndex: number;
  isFlipped: boolean;
  scrollOffsetRef: MutableRefObject<number>;
  hoveredIndexRef: MutableRefObject<number | null>;
  onCardPointerDown?: (e: any) => void;
  onCardPointerUp?: (e: any) => void;
  onCardPointerEnter?: (e: any) => void;
  onCardPointerLeave?: (e: any) => void;
}

export const CardPanel3D = memo(function CardPanel3D({
  item,
  itemIndex,
  isFlipped,
  scrollOffsetRef,
  hoveredIndexRef,
  onCardPointerDown,
  onCardPointerUp,
  onCardPointerEnter,
  onCardPointerLeave,
}: CardPanel3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const flipRef = useRef(0);
  const currentScaleRef = useRef(1);
  const currentOpacityRef = useRef(1);
  const currentBrightnessRef = useRef(1.0);
  const targetFlip = isFlipped ? Math.PI : 0;

  // Load item image via proxy
  const [itemImage, setItemImage] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!item.image) return;
    const withImgKey = item.id + ':img';
    if (textureCache.has(withImgKey)) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => setItemImage(img);
    img.onerror = () => console.error('[XR] Failed to load image:', item.image);
    img.src = proxyImageUrl(item.image);
    return () => { img.onload = null; img.onerror = null; };
  }, [item.id, item.image]);

  // Canvas-rendered textures — cached globally.
  // Always prefer the ':img' version if it exists (e.g. card remounted after
  // scrolling away — the image was already loaded on the first mount).
  const { frontTex, backTex } = useMemo(() => {
    const imgKey = item.id + ':img';
    const cachedWithImg = textureCache.get(imgKey);
    if (cachedWithImg) return { frontTex: cachedWithImg.front, backTex: cachedWithImg.back };

    const cacheKey = item.id + (itemImage ? ':img' : '');
    const cached = textureCache.get(cacheKey);
    if (cached) return { frontTex: cached.front, backTex: cached.back };

    const front = createFrontTexture(item, itemImage);
    const back = createBackTexture(item, itemImage);
    textureCache.set(cacheKey, { front, back });
    return { frontTex: front, backTex: back };
  }, [item, itemImage]);

  const frontMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const backMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    // ── Position & rotation from shared scrollOffsetRef ──
    const scrollVal = scrollOffsetRef.current;
    const offset = itemIndex - scrollVal;
    const angle = offset * ARC_STEP;

    groupRef.current.position.set(
      ARC_RADIUS * Math.sin(angle),
      CARD_Y,
      -ARC_RADIUS * Math.cos(angle),
    );

    // Visibility: hide if too far from center
    const absOffset = Math.abs(offset);
    if (absOffset > HALF_VISIBLE + 0.5) {
      groupRef.current.visible = false;
      return;
    }
    groupRef.current.visible = true;

    // Target scale & opacity from distance
    const targetScale = absOffset < 0.5 ? 1.0 : Math.max(0.85, 1.0 - (absOffset - 0.5) * 0.16);
    const targetOpacity = absOffset < 0.5 ? 1.0 : Math.max(0.4, 1.0 - (absOffset - 0.5) * 0.4);

    // Hover
    const isHovered = hoveredIndexRef.current === itemIndex;
    const hoverScale = isHovered ? targetScale * 1.04 : targetScale;
    const targetBrightness = isHovered ? 1.25 : 1.0;

    // Smooth interpolation
    const lerpFactor = 1 - Math.pow(0.001, delta);
    currentScaleRef.current += (hoverScale - currentScaleRef.current) * lerpFactor;
    currentOpacityRef.current += (targetOpacity - currentOpacityRef.current) * lerpFactor;
    currentBrightnessRef.current += (targetBrightness - currentBrightnessRef.current) * lerpFactor;

    // Flip animation
    const flipDiff = targetFlip - flipRef.current;
    flipRef.current += flipDiff * 0.12;

    // Apply transforms
    groupRef.current.rotation.y = -angle + flipRef.current;
    const s = currentScaleRef.current;
    groupRef.current.scale.set(s, s, s);

    // Material opacity & brightness
    const op = currentOpacityRef.current;
    const b = currentBrightnessRef.current;
    if (frontMatRef.current) {
      frontMatRef.current.opacity = op;
      frontMatRef.current.color.setRGB(b, b, b);
    }
    if (backMatRef.current) {
      backMatRef.current.opacity = op;
      backMatRef.current.color.setRGB(b, b, b);
    }
  });

  return (
    <group ref={groupRef}>
      {/* FRONT */}
      <mesh
        renderOrder={1}
        onPointerDown={onCardPointerDown}
        onPointerUp={onCardPointerUp}
        onPointerEnter={onCardPointerEnter}
        onPointerLeave={onCardPointerLeave}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial ref={frontMatRef} map={frontTex} transparent />
      </mesh>

      {/* BACK */}
      <mesh
        rotation={[0, Math.PI, 0]}
        renderOrder={1}
        onPointerDown={onCardPointerDown}
        onPointerUp={onCardPointerUp}
        onPointerEnter={onCardPointerEnter}
        onPointerLeave={onCardPointerLeave}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial ref={backMatRef} map={backTex} transparent />
      </mesh>
    </group>
  );
});
