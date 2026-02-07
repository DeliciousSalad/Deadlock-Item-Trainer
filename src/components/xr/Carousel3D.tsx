import { useRef, useState, useCallback, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CardPanel3D, ARC_RADIUS, ARC_STEP } from './CardPanel3D';
import { playSpatialFlipSound, playSpatialActiveSound, playSpatialHoverSound } from '../../utils/sounds';
import type { ProcessedItem } from '../../types';

// Layout
const VISIBLE_CARDS = 7;
const RENDER_BUFFER = 2; // extra cards on each side to prevent pop-in
const CARD_Y = 0;

// Interaction
const DRAG_SENSITIVITY = 12.0;
const CLICK_THRESHOLD = 0.02;
const MOMENTUM_FRICTION = 0.98;
const SNAP_STIFFNESS = 0.12;
const THUMBSTICK_THRESHOLD = 0.6;
const THUMBSTICK_COOLDOWN = 0.25;

interface Carousel3DProps {
  items: ProcessedItem[];
  currentIndex: number;
  flippedIndex: number | null;
  onIndexChange: (index: number) => void;
  onFlip: (index: number) => void;
  position?: [number, number, number];
}

function getCardWorldPos(
  cardIdx: number, centerIdx: number, groupPos: [number, number, number],
): [number, number, number] {
  const offset = cardIdx - centerIdx;
  const angle = offset * ARC_STEP;
  return [
    groupPos[0] + ARC_RADIUS * Math.sin(angle),
    groupPos[1] + CARD_Y,
    groupPos[2] - ARC_RADIUS * Math.cos(angle),
  ];
}

export function Carousel3D({
  items, currentIndex, flippedIndex, onIndexChange, onFlip, position = [0, 0, 0],
}: Carousel3DProps) {
  // The scroll position ref — shared with CardPanel3D for self-positioning
  const scrollOffsetRef = useRef(currentIndex);

  // visibleCenter: which integer index the render window is centered on.
  // Only updates when Math.round(scrollOffset) changes → rare re-renders.
  const [visibleCenter, setVisibleCenter] = useState(currentIndex);
  const visibleCenterRef = useRef(currentIndex);

  // Hover index tracked via ref (no state re-render)
  const hoveredIndexRef = useRef<number | null>(null);

  // Pointer / drag tracking
  const pointerActiveRef = useRef(false);
  const pointerCardIndexRef = useRef(-1);
  const pointerStartXRef = useRef(0);
  const pointerStartOffsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const needsStartCaptureRef = useRef(false);
  const lastHandXRef = useRef(0);
  const lastHandTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const isPhonePointerRef = useRef(false); // true when dragging via touch, not XR controller

  // Momentum
  const momentumRef = useRef(0);

  // Scroll-through sound tracking
  const lastCrossedIndexRef = useRef(currentIndex);

  // Hover cooldown
  const hoverCooldownRef = useRef(0);

  // Throttle onIndexChange during scroll to avoid hammering App re-renders
  const pendingIndexRef = useRef<number | null>(null);
  const indexChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Thumbstick
  const thumbstickCooldownRef = useRef(0);

  // Stable refs to latest props
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const currentIndexRef = useRef(currentIndex);
  const positionRef = useRef(position);
  positionRef.current = position;
  const onIndexChangeRef = useRef(onIndexChange);
  onIndexChangeRef.current = onIndexChange;
  const onFlipRef = useRef(onFlip);
  onFlipRef.current = onFlip;

  // Detect external index changes (nav buttons, shuffle, etc.)
  if (currentIndex !== currentIndexRef.current) {
    const newItem = items[currentIndex];
    if (newItem) {
      playSpatialActiveSound(newItem.type, getCardWorldPos(currentIndex, currentIndex, position));
    }
    currentIndexRef.current = currentIndex;
    if (!pointerActiveRef.current) {
      momentumRef.current = 0;
    }
  }

  // --- Pointer release ---
  const handleRelease = useCallback(() => {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    const pos = positionRef.current;
    const idx = currentIndexRef.current;
    const itms = itemsRef.current;

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      const vel = velocityRef.current;
      if (Math.abs(vel) > 0.005) {
        momentumRef.current = -vel * 0.08;
      } else {
        const nearest = Math.round(scrollOffsetRef.current);
        const clamped = Math.max(0, Math.min(itms.length - 1, nearest));
        if (clamped !== idx) {
          const snapItem = itms[clamped];
          if (snapItem) playSpatialActiveSound(snapItem.type, getCardWorldPos(clamped, clamped, pos));
          onIndexChangeRef.current(clamped);
        }
      }
    } else {
      const cardIdx = pointerCardIndexRef.current;
      if (cardIdx >= 0 && cardIdx < itms.length) {
        const clickedItem = itms[cardIdx];
        const cardPos = getCardWorldPos(cardIdx, idx, pos);
        hoverCooldownRef.current = 0.5;
        if (cardIdx === idx) {
          if (clickedItem) playSpatialFlipSound(clickedItem.type, cardPos);
          onFlipRef.current(cardIdx);
        } else {
          if (clickedItem) playSpatialActiveSound(clickedItem.type, cardPos);
          onIndexChangeRef.current(cardIdx);
        }
      }
    }
  }, []);

  const handleCardPointerDown = useCallback((cardIndex: number, e: any) => {
    e.stopPropagation();
    pointerActiveRef.current = true;
    pointerCardIndexRef.current = cardIndex;
    isDraggingRef.current = false;
    pointerStartOffsetRef.current = scrollOffsetRef.current;
    momentumRef.current = 0;
    velocityRef.current = 0;
    needsStartCaptureRef.current = true;
    lastHandTimeRef.current = performance.now();
    // Capture initial world X for phone/touch drag (via drag plane)
    isPhonePointerRef.current = false;
    if (e.point) {
      pointerStartXRef.current = e.point.x;
      lastHandXRef.current = e.point.x;
    }
  }, []);

  const handleCardPointerUp = useCallback((e: any) => {
    e.stopPropagation();
    handleRelease();
  }, [handleRelease]);

  const handleCardPointerMove = useCallback((e: any) => {
    if (!pointerActiveRef.current) return;
    e.stopPropagation();
    if (!e.point) return;

    // This is a phone/touch pointer move — mark as phone mode
    isPhonePointerRef.current = true;

    const currentX = e.point.x;
    const now = performance.now();
    const dt = (now - lastHandTimeRef.current) / 1000;

    const totalDelta = currentX - pointerStartXRef.current;
    if (!isDraggingRef.current && Math.abs(totalDelta) > CLICK_THRESHOLD) {
      isDraggingRef.current = true;
    }
    if (isDraggingRef.current) {
      if (dt > 0.001) velocityRef.current = (currentX - lastHandXRef.current) / dt;
      scrollOffsetRef.current = pointerStartOffsetRef.current - totalDelta * DRAG_SENSITIVITY;
      scrollOffsetRef.current = Math.max(-0.3, Math.min(itemsRef.current.length - 0.7, scrollOffsetRef.current));
    }
    lastHandXRef.current = currentX;
    lastHandTimeRef.current = now;
  }, []);

  const handleCardPointerEnter = useCallback((cardIndex: number, e: any) => {
    e.stopPropagation();
    hoveredIndexRef.current = cardIndex;
    if (!pointerActiveRef.current && momentumRef.current === 0 && hoverCooldownRef.current <= 0) {
      const item = itemsRef.current[cardIndex];
      if (item) {
        playSpatialHoverSound(item.type, getCardWorldPos(cardIndex, currentIndexRef.current, positionRef.current));
      }
    }
  }, []);

  const handleCardPointerLeave = useCallback((_cardIndex: number, e: any) => {
    e.stopPropagation();
    hoveredIndexRef.current = null;
  }, []);

  // --- Per-frame: physics only (cards self-position via scrollOffsetRef) ---
  useFrame((state, delta) => {
    const target = currentIndexRef.current;
    const itms = itemsRef.current;
    const pos = positionRef.current;

    // Cooldowns
    if (hoverCooldownRef.current > 0) {
      hoverCooldownRef.current = Math.max(0, hoverCooldownRef.current - delta);
    }

    // XR input tracking while pointer is held
    if (pointerActiveRef.current) {
      let inputHandled = false;
      let currentHandX = lastHandXRef.current;

      try {
        const gl = state.gl;
        const session = gl.xr.getSession();
        if (session) {
          const frame = gl.xr.getFrame();
          const refSpace = gl.xr.getReferenceSpace();

          for (const source of session.inputSources) {
            // XR controller with gamepad (Quest, etc.)
            if (source.gamepad) {
              if (source.gamepad.buttons[0]?.pressed) {
                inputHandled = true;
                if (frame && refSpace && source.targetRaySpace) {
                  const pose = frame.getPose(source.targetRaySpace, refSpace);
                  if (pose) currentHandX = pose.transform.position.x;
                }
              } else {
                // Controller exists but trigger released → end drag
                handleRelease();
                inputHandled = true;
              }
              break;
            }

            // Phone screen touch (targetRayMode === 'screen')
            if (source.targetRayMode === 'screen' && frame && refSpace && source.targetRaySpace) {
              inputHandled = true;
              isPhonePointerRef.current = true;
              const pose = frame.getPose(source.targetRaySpace, refSpace);
              if (pose) {
                // Use ray origin X for horizontal tracking
                currentHandX = pose.transform.position.x;
              }
              break;
            }
          }
        }
      } catch { /* ignore */ }

      if (inputHandled && pointerActiveRef.current) {
        if (needsStartCaptureRef.current) {
          pointerStartXRef.current = currentHandX;
          lastHandXRef.current = currentHandX;
          needsStartCaptureRef.current = false;
        } else {
          const now = performance.now();
          const dt = (now - lastHandTimeRef.current) / 1000;
          const totalDelta = currentHandX - pointerStartXRef.current;
          if (!isDraggingRef.current && Math.abs(totalDelta) > CLICK_THRESHOLD) {
            isDraggingRef.current = true;
          }
          if (isDraggingRef.current) {
            if (dt > 0.001) velocityRef.current = (currentHandX - lastHandXRef.current) / dt;
            scrollOffsetRef.current = pointerStartOffsetRef.current - totalDelta * DRAG_SENSITIVITY;
            scrollOffsetRef.current = Math.max(-0.3, Math.min(itms.length - 0.7, scrollOffsetRef.current));
          }
          lastHandXRef.current = currentHandX;
          lastHandTimeRef.current = now;
        }
      }
    }

    // Momentum / snap
    if (!pointerActiveRef.current) {
      if (momentumRef.current !== 0) {
        scrollOffsetRef.current += momentumRef.current * delta * 60;
        momentumRef.current *= MOMENTUM_FRICTION;
        if (Math.abs(momentumRef.current) < 0.003) {
          momentumRef.current = 0;
          // Flush any pending throttled index change immediately
          if (indexChangeTimerRef.current) {
            clearTimeout(indexChangeTimerRef.current);
            indexChangeTimerRef.current = null;
          }
          const nearest = Math.round(scrollOffsetRef.current);
          const clamped = Math.max(0, Math.min(itms.length - 1, nearest));
          if (clamped !== target) {
            const snapItem = itms[clamped];
            if (snapItem) playSpatialActiveSound(snapItem.type, getCardWorldPos(clamped, clamped, pos));
            onIndexChangeRef.current(clamped);
          }
          pendingIndexRef.current = null;
        }
      } else {
        const diff = target - scrollOffsetRef.current;
        if (Math.abs(diff) > 0.001) {
          scrollOffsetRef.current += diff * SNAP_STIFFNESS * Math.min(delta * 60, 3);
        } else {
          scrollOffsetRef.current = target;
        }
      }
    }

    // Clamp
    scrollOffsetRef.current = Math.max(-0.5, Math.min(itms.length - 0.5, scrollOffsetRef.current));

    // Scroll-through sound + throttled index update
    const currentNearest = Math.round(scrollOffsetRef.current);
    const clampedNearest = Math.max(0, Math.min(itms.length - 1, currentNearest));
    if (clampedNearest !== lastCrossedIndexRef.current) {
      const crossedItem = itms[clampedNearest];
      if (crossedItem && (isDraggingRef.current || momentumRef.current !== 0)) {
        playSpatialActiveSound(crossedItem.type, getCardWorldPos(clampedNearest, clampedNearest, pos));
        // Throttle the React state update: store pending index, flush after 120ms idle
        if (clampedNearest !== target) {
          pendingIndexRef.current = clampedNearest;
          if (indexChangeTimerRef.current) clearTimeout(indexChangeTimerRef.current);
          indexChangeTimerRef.current = setTimeout(() => {
            if (pendingIndexRef.current !== null) {
              onIndexChangeRef.current(pendingIndexRef.current);
              pendingIndexRef.current = null;
            }
            indexChangeTimerRef.current = null;
          }, 120);
        }
      }
      lastCrossedIndexRef.current = clampedNearest;
    }

    // Update visible window center (triggers re-render ONLY when it shifts by 1 card)
    const newCenter = Math.max(0, Math.min(itms.length - 1, clampedNearest));
    if (newCenter !== visibleCenterRef.current) {
      visibleCenterRef.current = newCenter;
      setVisibleCenter(newCenter);
    }

    // Thumbstick
    thumbstickCooldownRef.current = Math.max(0, thumbstickCooldownRef.current - delta);
    if (!pointerActiveRef.current && thumbstickCooldownRef.current <= 0) {
      try {
        const session = state.gl.xr.getSession();
        if (session) {
          for (const source of session.inputSources) {
            if (source.gamepad && source.gamepad.axes.length >= 4) {
              const thumbX = source.gamepad.axes[2];
              if (thumbX > THUMBSTICK_THRESHOLD && target < itms.length - 1) {
                const nextItem = itms[target + 1];
                if (nextItem) playSpatialActiveSound(nextItem.type, getCardWorldPos(target + 1, target + 1, pos));
                onIndexChangeRef.current(target + 1);
                thumbstickCooldownRef.current = THUMBSTICK_COOLDOWN;
              } else if (thumbX < -THUMBSTICK_THRESHOLD && target > 0) {
                const prevItem = itms[target - 1];
                if (prevItem) playSpatialActiveSound(prevItem.type, getCardWorldPos(target - 1, target - 1, pos));
                onIndexChangeRef.current(target - 1);
                thumbstickCooldownRef.current = THUMBSTICK_COOLDOWN;
              }
            }
          }
        }
      } catch { /* ignore */ }
    }
  });

  // ── Render window: VISIBLE_CARDS + buffer, centered on visibleCenter ──
  const halfRender = Math.floor(VISIBLE_CARDS / 2) + RENDER_BUFFER;
  const startIdx = Math.max(0, visibleCenter - halfRender);
  const endIdx = Math.min(items.length - 1, visibleCenter + halfRender);

  return (
    <group position={position}>

      {items.length > 0 && Array.from({ length: endIdx - startIdx + 1 }, (_, i) => {
        const idx = startIdx + i;
        const item = items[idx];
        if (!item) return null;

        return (
          <MemoCard
            key={item.id}
            item={item}
            itemIndex={idx}
            isFlipped={flippedIndex === idx}
            scrollOffsetRef={scrollOffsetRef}
            hoveredIndexRef={hoveredIndexRef}
            onCardPointerDown={handleCardPointerDown}
            onCardPointerUp={handleCardPointerUp}
            onCardPointerMove={handleCardPointerMove}
            onCardPointerEnter={handleCardPointerEnter}
            onCardPointerLeave={handleCardPointerLeave}
          />
        );
      })}
    </group>
  );
}

/** Wrapper that binds the card index into stable callbacks */
interface MemoCardProps {
  item: ProcessedItem;
  itemIndex: number;
  isFlipped: boolean;
  scrollOffsetRef: React.MutableRefObject<number>;
  hoveredIndexRef: React.MutableRefObject<number | null>;
  onCardPointerDown: (cardIndex: number, e: any) => void;
  onCardPointerUp: (e: any) => void;
  onCardPointerMove: (e: any) => void;
  onCardPointerEnter: (cardIndex: number, e: any) => void;
  onCardPointerLeave: (cardIndex: number, e: any) => void;
}

const MemoCard = memo(function MemoCardInner({
  item, itemIndex, isFlipped, scrollOffsetRef, hoveredIndexRef,
  onCardPointerDown, onCardPointerUp, onCardPointerMove, onCardPointerEnter, onCardPointerLeave,
}: MemoCardProps) {
  const handleDown = useCallback((e: any) => onCardPointerDown(itemIndex, e), [onCardPointerDown, itemIndex]);
  const handleEnter = useCallback((e: any) => onCardPointerEnter(itemIndex, e), [onCardPointerEnter, itemIndex]);
  const handleLeave = useCallback((e: any) => onCardPointerLeave(itemIndex, e), [onCardPointerLeave, itemIndex]);

  return (
    <CardPanel3D
      item={item}
      itemIndex={itemIndex}
      isFlipped={isFlipped}
      scrollOffsetRef={scrollOffsetRef}
      hoveredIndexRef={hoveredIndexRef}
      onCardPointerDown={handleDown}
      onCardPointerUp={onCardPointerUp}
      onCardPointerMove={onCardPointerMove}
      onCardPointerEnter={handleEnter}
      onCardPointerLeave={handleLeave}
    />
  );
}, (prev, next) => {
  return prev.item === next.item
    && prev.itemIndex === next.itemIndex
    && prev.isFlipped === next.isFlipped;
});
