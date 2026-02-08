import { useRef, useMemo, useState, useEffect, memo, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ProcessedItem } from '../../types';
import {
  createFrontTexture,
  createBackFrameTexture,
  createBackContentTexture,
  TEX_H,
  CONTENT_TOP_PX,
} from './cardTextures';

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

// Content mesh position (top edge anchored to header bottom)
const CONTENT_TOP_WORLD = CARD_H / 2 - (CONTENT_TOP_PX / TEX_H) * CARD_H;

// ── Global texture cache keyed by item id + image state ──
const textureCache = new Map<string, {
  front: THREE.CanvasTexture;
  backFrame: THREE.CanvasTexture;
  backContent: THREE.CanvasTexture;
}>();

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
  const { frontTex, backFrameTex, backContentTex } = useMemo(() => {
    const imgKey = item.id + ':img';
    const cachedWithImg = textureCache.get(imgKey);
    if (cachedWithImg) return {
      frontTex: cachedWithImg.front,
      backFrameTex: cachedWithImg.backFrame,
      backContentTex: cachedWithImg.backContent,
    };

    const cacheKey = item.id + (itemImage ? ':img' : '');
    const cached = textureCache.get(cacheKey);
    if (cached) return {
      frontTex: cached.front,
      backFrameTex: cached.backFrame,
      backContentTex: cached.backContent,
    };

    const front = createFrontTexture(item, itemImage);
    const backFrame = createBackFrameTexture(item, itemImage);
    const backContent = createBackContentTexture(item);
    textureCache.set(cacheKey, { front, backFrame, backContent });
    return { frontTex: front, backFrameTex: backFrame, backContentTex: backContent };
  }, [item, itemImage]);

  // Detect scrollable content texture and set up max scroll
  const contentAreaH: number = (backContentTex as any)._contentAreaH || 1;
  const contentHeight: number = (backContentTex as any)._contentHeight || contentAreaH;
  const isScrollable = contentHeight > contentAreaH;
  const maxScroll = isScrollable ? contentHeight - contentAreaH : 0;

  // Content mesh dimensions (per-item, depends on footer height)
  const contentWorldH = (contentAreaH / TEX_H) * CARD_H;
  const contentYOffset = CONTENT_TOP_WORLD - contentWorldH / 2;

  // Update the shared max scroll ref so the carousel can clamp
  useEffect(() => {
    if (isFlipped) {
      cardScrollMaxRef.current = isScrollable ? maxScroll : 0;
    }
  }, [isFlipped, isScrollable, maxScroll, cardScrollMaxRef]);

  // Reset scroll when card flips back to front
  useEffect(() => {
    if (!isFlipped && isScrollable) {
      cardScrollYRef.current = 0;
      // Reset texture UV to top
      backContentTex.repeat.set(1, contentAreaH / contentHeight);
      backContentTex.offset.set(0, 1 - contentAreaH / contentHeight);
      backContentTex.needsUpdate = true;
    }
  }, [isFlipped, isScrollable, backContentTex, contentHeight, contentAreaH, cardScrollYRef]);

  const frontMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const backFrameMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const backContentMatRef = useRef<THREE.MeshBasicMaterial>(null);

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

    // Material opacity & brightness (all three materials)
    const op = currentOpacityRef.current;
    const b = currentBrightnessRef.current;
    if (frontMatRef.current) {
      frontMatRef.current.opacity = op;
      frontMatRef.current.color.setRGB(b, b, b);
    }
    if (backFrameMatRef.current) {
      backFrameMatRef.current.opacity = op;
      backFrameMatRef.current.color.setRGB(b, b, b);
    }
    if (backContentMatRef.current) {
      backContentMatRef.current.opacity = op;
      backContentMatRef.current.color.setRGB(b, b, b);
    }

    // ── Scroll UV update (on the content texture) ──
    if (isScrollable && isFlipped) {
      const scrollY = cardScrollYRef.current;
      if (Math.abs(scrollY - lastScrollYRef.current) > 0.5) {
        const clamped = Math.max(0, Math.min(maxScroll, scrollY));
        backContentTex.offset.y = (contentHeight - contentAreaH - clamped) / contentHeight;
        lastScrollYRef.current = clamped;
      }

      // Update scroll indicator
      if (scrollTrackRef.current && scrollThumbRef.current) {
        scrollTrackRef.current.visible = true;
        scrollThumbRef.current.visible = true;
        const clamped = Math.max(0, Math.min(maxScroll, scrollY));
        const fraction = maxScroll > 0 ? clamped / maxScroll : 0;
        const trackH = contentWorldH * 0.95;
        const thumbH = Math.max(0.03, (contentAreaH / contentHeight) * trackH);
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

      {/* BACK — Scrollable content (behind frame) */}
      <mesh
        rotation={[0, Math.PI, 0]}
        position={[0, contentYOffset, -0.001]}
        renderOrder={1}
      >
        <planeGeometry args={[CARD_W, contentWorldH]} />
        <meshBasicMaterial ref={backContentMatRef} map={backContentTex} transparent depthWrite={false} />
      </mesh>

      {/* BACK — Static frame (border + header, in front of content) */}
      <mesh
        rotation={[0, Math.PI, 0]}
        renderOrder={2}
        onPointerDown={onCardPointerDown}
        onPointerUp={onCardPointerUp}
        onPointerMove={onCardPointerMove}
        onPointerEnter={onCardPointerEnter}
        onPointerLeave={onCardPointerLeave}
      >
        <planeGeometry args={[CARD_W, CARD_H]} />
        <meshBasicMaterial ref={backFrameMatRef} map={backFrameTex} transparent depthWrite={false} />
      </mesh>

      {/* SCROLL INDICATOR (on the back face side, in front of frame) */}
      {isScrollable && (
        <group rotation={[0, Math.PI, 0]} position={[-(CARD_W / 2 - 0.010), contentYOffset, 0.003]}>
          {/* Track */}
          <mesh ref={scrollTrackRef} visible={false} renderOrder={4}>
            <planeGeometry args={[0.008, contentWorldH * 0.95]} />
            <meshBasicMaterial color="#333333" transparent opacity={0.5} depthWrite={false} />
          </mesh>
          {/* Thumb */}
          <mesh ref={scrollThumbRef} visible={false} renderOrder={5}>
            <planeGeometry args={[0.008, 0.03]} />
            <meshBasicMaterial color="#aaaaaa" transparent opacity={0.8} depthWrite={false} />
          </mesh>
        </group>
      )}
    </group>
  );
});
