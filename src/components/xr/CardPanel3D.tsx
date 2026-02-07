import { useRef, useMemo, useState, useEffect, memo, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ProcessedItem } from '../../types';
import { createFrontTexture, createBackTexture, TEX_H } from './cardTextures';

const CDN_ORIGIN = 'https://assets-bucket.deadlock-api.com';

function proxyImageUrl(url: string): string {
  if (url.startsWith(CDN_ORIGIN)) {
    return '/_img-proxy' + url.slice(CDN_ORIGIN.length);
  }
  return url;
}

export const CARD_W = 0.28;
export const CARD_H = 0.40;
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
  cardScrollYRef: MutableRefObject<number>;
  cardScrollMaxRef: MutableRefObject<number>;
  onCardPointerDown?: (e: any) => void;
  onCardPointerUp?: (e: any) => void;
  onCardPointerMove?: (e: any) => void;
  onCardPointerEnter?: (e: any) => void;
  onCardPointerLeave?: (e: any) => void;
}

export const CardPanel3D = memo(function CardPanel3D({
  item,
  itemIndex,
  isFlipped,
  scrollOffsetRef,
  hoveredIndexRef,
  cardScrollYRef,
  cardScrollMaxRef,
  onCardPointerDown,
  onCardPointerUp,
  onCardPointerMove,
  onCardPointerEnter,
  onCardPointerLeave,
}: CardPanel3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const flipRef = useRef(0);
  const currentScaleRef = useRef(1);
  const currentOpacityRef = useRef(1);
  const currentBrightnessRef = useRef(1.0);
  const targetFlip = isFlipped ? Math.PI : 0;

  // Scroll indicator refs
  const scrollTrackRef = useRef<THREE.Mesh>(null);
  const scrollThumbRef = useRef<THREE.Mesh>(null);

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

  // Detect scrollable back texture and set up max scroll
  const contentHeight = (backTex as any)._contentHeight || TEX_H;
  const isScrollable = contentHeight > TEX_H;
  const maxScroll = isScrollable ? contentHeight - TEX_H : 0;

  // Update the shared max scroll ref so the carousel can clamp
  useEffect(() => {
    // Only set if this card is the current center/flipped card
    if (isFlipped && isScrollable) {
      cardScrollMaxRef.current = maxScroll;
    }
  }, [isFlipped, isScrollable, maxScroll, cardScrollMaxRef]);

  // Reset scroll when card flips back to front
  useEffect(() => {
    if (!isFlipped && isScrollable) {
      cardScrollYRef.current = 0;
      // Reset texture UV to top
      backTex.repeat.set(1, TEX_H / contentHeight);
      backTex.offset.set(0, 1 - TEX_H / contentHeight);
      backTex.needsUpdate = true;
    }
  }, [isFlipped, isScrollable, backTex, contentHeight, cardScrollYRef]);

  const frontMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const backMatRef = useRef<THREE.MeshBasicMaterial>(null);

  // Track last scroll Y for change detection
  const lastScrollYRef = useRef(0);

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

    // Flip animation — 0.18 lerp ≈ 0.4s at 72fps, matching 2D CSS transition
    const flipDiff = targetFlip - flipRef.current;
    flipRef.current += flipDiff * 0.18;

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

    // ── Scroll UV update ──
    if (isScrollable && isFlipped) {
      const scrollY = cardScrollYRef.current;
      if (Math.abs(scrollY - lastScrollYRef.current) > 0.5) {
        const clamped = Math.max(0, Math.min(maxScroll, scrollY));
        backTex.offset.y = (contentHeight - TEX_H - clamped) / contentHeight;
        backTex.needsUpdate = true;
        lastScrollYRef.current = clamped;
      }

      // Update scroll indicator
      if (scrollTrackRef.current && scrollThumbRef.current) {
        scrollTrackRef.current.visible = true;
        scrollThumbRef.current.visible = true;
        const clamped = Math.max(0, Math.min(maxScroll, scrollY));
        const fraction = maxScroll > 0 ? clamped / maxScroll : 0;
        const trackH = CARD_H * 0.85;
        const thumbH = Math.max(0.03, (TEX_H / contentHeight) * trackH);
        scrollThumbRef.current.scale.y = thumbH / 0.03; // base geo is 0.03 tall
        const thumbRange = trackH - thumbH;
        scrollThumbRef.current.position.y = (trackH / 2 - thumbH / 2) - fraction * thumbRange;
      }
    } else {
      // Hide scroll indicator when not scrollable or not flipped
      if (scrollTrackRef.current) scrollTrackRef.current.visible = false;
      if (scrollThumbRef.current) scrollThumbRef.current.visible = false;
    }
  });

  return (
    <group ref={groupRef}>
      {/* FRONT */}
      <mesh
        renderOrder={1}
        onPointerDown={onCardPointerDown}
        onPointerUp={onCardPointerUp}
        onPointerMove={onCardPointerMove}
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
        onPointerMove={onCardPointerMove}
        onPointerEnter={onCardPointerEnter}
        onPointerLeave={onCardPointerLeave}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial ref={backMatRef} map={backTex} transparent />
      </mesh>

      {/* SCROLL INDICATOR (on the back face side) */}
      {isScrollable && (
        <group rotation={[0, Math.PI, 0]} position={[-(CARD_W / 2 + 0.012), 0, 0.001]}>
          {/* Track */}
          <mesh ref={scrollTrackRef} visible={false} renderOrder={2}>
            <planeGeometry args={[0.008, CARD_H * 0.85]} />
            <meshBasicMaterial color="#333333" transparent opacity={0.5} />
          </mesh>
          {/* Thumb */}
          <mesh ref={scrollThumbRef} visible={false} renderOrder={3}>
            <planeGeometry args={[0.008, 0.03]} />
            <meshBasicMaterial color="#aaaaaa" transparent opacity={0.8} />
          </mesh>
        </group>
      )}
    </group>
  );
});
