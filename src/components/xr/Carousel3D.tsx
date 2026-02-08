import { useRef, useState, useCallback, useEffect, memo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CardPanel3D, ARC_RADIUS, ARC_STEP, CARD_H } from './CardPanel3D';
import { playSpatialFlipSound, playSpatialActiveSound, playSpatialHoverSound } from '../../utils/sounds';
import type { ProcessedItem } from '../../types';

// Reusable THREE objects for ray direction extraction (avoids GC pressure in useFrame)
const _quat = new THREE.Quaternion();
const _dir = new THREE.Vector3();

// Layout
const VISIBLE_CARDS = 7;
const RENDER_BUFFER = 2; // extra cards on each side to prevent pop-in
const CARD_Y = 0;

// Interaction
const DRAG_SENSITIVITY = 1.5; // Cards per world-unit of ray-plane movement
const CLICK_THRESHOLD = 0.08; // 8 cm dead-zone — needs intentional movement to start a drag
const MOMENTUM_FRICTION = 0.96; // Balanced decay — flicks coast a few cards then settle
const VELOCITY_SMOOTHING = 0.35; // Exponential smoothing factor (0 = full smooth, 1 = raw)
const MIN_FLICK_VEL = 0.3; // Minimum velocity before momentum is applied
const SNAP_STIFFNESS = 0.15; // Snappy settle — matches 2D ~400ms ease-out feel
const THUMBSTICK_THRESHOLD = 0.6;
const THUMBSTICK_COOLDOWN = 0.25;

// Card content scroll
const CARD_SCROLL_SENSITIVITY = 4000;
const CARD_SCROLL_MOMENTUM_FRICTION = 0.92;
const CARD_SCROLL_THUMBSTICK_SPEED = 600;

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
  const pointerStartYRef = useRef(0);
  const pointerStartOffsetRef = useRef(0);
  const pointerStartScrollYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragAxisRef = useRef<'none' | 'horizontal' | 'vertical'>('none');
  const needsStartCaptureRef = useRef(false);
  const lastHandXRef = useRef(0);
  const lastHandYRef = useRef(0);
  const lastHandTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const scrollVelocityRef = useRef(0);

  // Momentum
  const momentumRef = useRef(0);
  const scrollMomentumRef = useRef(0);

  // Card content scroll (shared with flipped CardPanel3D)
  const cardScrollYRef = useRef(0);
  const cardScrollMaxRef = useRef(0);

  // Scroll-through sound tracking
  const lastCrossedIndexRef = useRef(currentIndex);

  // Hover cooldown
  const hoverCooldownRef = useRef(0);

  // Throttle onIndexChange during scroll to avoid hammering App re-renders
  const pendingIndexRef = useRef<number | null>(null);
  const indexChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Thumbstick
  const thumbstickCooldownRef = useRef(0);

  // When true, useFrame is tracking gamepad-based XR input (Quest controllers) —
  // disable R3F onPointerMove to avoid coordinate space conflicts.
  // Stays false for gaze/transient-pointer sources which rely on R3F pointer events.
  const xrTrackingRef = useRef(false);

  // Touch-based drag (reliable fallback for phone XR where XR input sources are unreliable)
  const touchDraggingRef = useRef(false);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const touchStartScrollRef = useRef(0);
  const touchStartScrollYRef2 = useRef(0); // card scroll Y at touch start
  const touchScreenWRef = useRef(360); // viewport width captured at touch start
  const touchLastXRef = useRef(0);
  const touchLastYRef = useRef(0);
  const touchLastTimeRef = useRef(0);
  const touchVelocityRef = useRef(0);
  const touchScrollVelocityRef = useRef(0);
  const touchDragAxisRef = useRef<'none' | 'horizontal' | 'vertical'>('none');

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
  const flippedIndexRef = useRef(flippedIndex);
  flippedIndexRef.current = flippedIndex;

  // ── Window-level touch event drag (phone XR input) ──
  // Listeners go on `window` instead of the canvas because in immersive-ar mode
  // the WebXR compositor may prevent touch events from reaching the canvas element.
  // This component is only mounted when XR is active, so no 2D-mode guard is needed.

  useEffect(() => {
    // Full-screen-width swipe ≈ 2 cards
    const TOUCH_SENSITIVITY = 2.0;
    const TOUCH_DRAG_THRESHOLD = 10; // pixels

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      touchStartXRef.current = x;
      touchStartYRef.current = y;
      touchStartScrollRef.current = scrollOffsetRef.current;
      touchStartScrollYRef2.current = cardScrollYRef.current;
      // Capture the actual viewport width NOW — stable for this entire gesture,
      // works in both portrait and landscape, and correct even during XR sessions.
      touchScreenWRef.current = window.innerWidth || screen.width || 360;
      touchLastXRef.current = x;
      touchLastYRef.current = y;
      touchLastTimeRef.current = performance.now();
      touchVelocityRef.current = 0;
      touchScrollVelocityRef.current = 0;
      touchDraggingRef.current = false;
      touchDragAxisRef.current = 'none';
      // Reset card index — only set if handleCardPointerDown fires for this touch.
      // Prevents stale index from triggering a flip when tapping UI buttons.
      pointerCardIndexRef.current = -1;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;
      const now = performance.now();
      const dt = (now - touchLastTimeRef.current) / 1000;
      const pxDeltaX = x - touchStartXRef.current;
      const pxDeltaY = y - touchStartYRef.current;
      const sw = touchScreenWRef.current; // use width captured at touch start

      // Activate drag mode once past threshold — lock axis
      if (!touchDraggingRef.current) {
        const absX = Math.abs(pxDeltaX);
        const absY = Math.abs(pxDeltaY);
        if (absX > TOUCH_DRAG_THRESHOLD || absY > TOUCH_DRAG_THRESHOLD) {
          touchDraggingRef.current = true;
          isDraggingRef.current = true;
          pointerActiveRef.current = false;
          momentumRef.current = 0;

          // Direction lock: vertical card scroll if center card is flipped & scrollable
          const isCenterFlipped = flippedIndexRef.current === currentIndexRef.current && cardScrollMaxRef.current > 0;
          if (isCenterFlipped && absY > absX) {
            touchDragAxisRef.current = 'vertical';
          } else {
            touchDragAxisRef.current = 'horizontal';
          }
        }
      }

      if (touchDraggingRef.current) {
        if (touchDragAxisRef.current === 'vertical') {
          // Card content scroll
          if (dt > 0.001) {
            const rawVel = (y - touchLastYRef.current) / dt;
            touchScrollVelocityRef.current = touchScrollVelocityRef.current * 0.6 + rawVel * 0.4;
          }
          const TOUCH_SCROLL_SENSITIVITY = 3.0; // px → content-px multiplier
          cardScrollYRef.current = touchStartScrollYRef2.current - pxDeltaY * TOUCH_SCROLL_SENSITIVITY;
          cardScrollYRef.current = Math.max(0, Math.min(cardScrollMaxRef.current, cardScrollYRef.current));
        } else {
          // Carousel drag
          const normDelta = pxDeltaX / sw;
          if (dt > 0.001) {
            const rawVel = ((x - touchLastXRef.current) / sw) / dt;
            touchVelocityRef.current = touchVelocityRef.current * 0.6 + rawVel * 0.4;
          }
          scrollOffsetRef.current = touchStartScrollRef.current - normDelta * TOUCH_SENSITIVITY;
          const len = itemsRef.current.length;
          scrollOffsetRef.current = Math.max(-0.3, Math.min(len - 0.7, scrollOffsetRef.current));
        }
      }

      touchLastXRef.current = x;
      touchLastYRef.current = y;
      touchLastTimeRef.current = now;
    };

    const onTouchEnd = () => {
      if (!touchDraggingRef.current) {
        // No drag occurred — treat as a tap (card flip / index change)
        const cardIdx = pointerCardIndexRef.current;
        const idx = currentIndexRef.current;
        const itms = itemsRef.current;
        if (cardIdx >= 0 && cardIdx < itms.length) {
          const pos = positionRef.current;
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
        return;
      }

      const axis = touchDragAxisRef.current;
      touchDraggingRef.current = false;
      touchDragAxisRef.current = 'none';

      if (axis === 'vertical') {
        // Card scroll momentum
        const svel = touchScrollVelocityRef.current;
        if (Math.abs(svel) > 10) {
          scrollMomentumRef.current = -svel * 0.08;
        }
      } else {
        const vel = touchVelocityRef.current;
        if (Math.abs(vel) > 0.15) {
          momentumRef.current = -vel * 0.02;
        } else {
          // Snap to nearest
          const nearest = Math.round(scrollOffsetRef.current);
          const clamped = Math.max(0, Math.min(itemsRef.current.length - 1, nearest));
          if (clamped !== currentIndexRef.current) {
            const pos = positionRef.current;
            const snapItem = itemsRef.current[clamped];
            if (snapItem) playSpatialActiveSound(snapItem.type, getCardWorldPos(clamped, clamped, pos));
            onIndexChangeRef.current(clamped);
          }
        }
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // Detect external index changes (nav buttons, shuffle, etc.)
  if (currentIndex !== currentIndexRef.current) {
    // Only play sound + kill momentum for truly external changes (nav buttons, shuffle).
    // When momentum is coasting and crosses a card boundary, the throttled index update
    // fires onIndexChange which loops back here — don't kill momentum in that case.
    const isExternalChange = momentumRef.current === 0 && !pointerActiveRef.current && !touchDraggingRef.current;
    if (isExternalChange) {
      const newItem = items[currentIndex];
      if (newItem) {
        playSpatialActiveSound(newItem.type, getCardWorldPos(currentIndex, currentIndex, position));
      }
    }
    currentIndexRef.current = currentIndex;
  }

  // --- Pointer release ---
  const handleRelease = useCallback(() => {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    const pos = positionRef.current;
    const idx = currentIndexRef.current;
    const itms = itemsRef.current;
    const axis = dragAxisRef.current;
    dragAxisRef.current = 'none';

    if (isDraggingRef.current) {
      isDraggingRef.current = false;

      if (axis === 'vertical') {
        // Card content scroll momentum
        const svel = scrollVelocityRef.current;
        if (Math.abs(svel) > 10) {
          scrollMomentumRef.current = -svel * 0.08;
        }
      } else {
        // Carousel momentum
        const vel = velocityRef.current;
        if (Math.abs(vel) > MIN_FLICK_VEL) {
          momentumRef.current = -vel * 0.02;
        } else {
          const nearest = Math.round(scrollOffsetRef.current);
          const clamped = Math.max(0, Math.min(itms.length - 1, nearest));
          if (clamped !== idx) {
            const snapItem = itms[clamped];
            if (snapItem) playSpatialActiveSound(snapItem.type, getCardWorldPos(clamped, clamped, pos));
            onIndexChangeRef.current(clamped);
          }
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
    // Screen-touch input is handled entirely by the window-level touch handlers.
    // Skip R3F pointer handling to avoid double-flip (pointerup fires before touchstart).
    const src = e.inputSource || e.nativeEvent?.inputSource;
    if (src?.targetRayMode === 'screen') {
      pointerCardIndexRef.current = cardIndex; // still capture which card was tapped
      return;
    }
    pointerActiveRef.current = true;
    pointerCardIndexRef.current = cardIndex;
    isDraggingRef.current = false;
    dragAxisRef.current = 'none';
    pointerStartOffsetRef.current = scrollOffsetRef.current;
    pointerStartScrollYRef.current = cardScrollYRef.current;
    momentumRef.current = 0;
    scrollMomentumRef.current = 0;
    velocityRef.current = 0;
    scrollVelocityRef.current = 0;
    needsStartCaptureRef.current = true;
    // Only claim useFrame XR tracking for gamepad-based controllers (Quest, etc.).
    // Gaze and transient-pointer sources (Vision Pro, Galaxy XR) have no gamepad
    // and rely entirely on R3F pointer events — don't block those.
    xrTrackingRef.current = !!(src?.gamepad);
    lastHandTimeRef.current = performance.now();
    if (e.point) {
      pointerStartXRef.current = e.point.x;
      pointerStartYRef.current = e.point.y;
      lastHandXRef.current = e.point.x;
      lastHandYRef.current = e.point.y;
    }
  }, []);

  // Background drag — start a drag from empty space near the carousel (no card to flip)
  const handleBgPointerDown = useCallback((e: any) => {
    e.stopPropagation();
    pointerActiveRef.current = true;
    pointerCardIndexRef.current = -1; // no card targeted — drag only
    isDraggingRef.current = false;
    dragAxisRef.current = 'none';
    pointerStartOffsetRef.current = scrollOffsetRef.current;
    pointerStartScrollYRef.current = cardScrollYRef.current;
    momentumRef.current = 0;
    scrollMomentumRef.current = 0;
    velocityRef.current = 0;
    scrollVelocityRef.current = 0;
    needsStartCaptureRef.current = true;
    const src2 = e.inputSource || e.nativeEvent?.inputSource;
    xrTrackingRef.current = !!(src2?.gamepad);
    lastHandTimeRef.current = performance.now();
    if (e.point) {
      pointerStartXRef.current = e.point.x;
      pointerStartYRef.current = e.point.y;
      lastHandXRef.current = e.point.x;
      lastHandYRef.current = e.point.y;
    }
  }, []);

  const handleCardPointerUp = useCallback((e: any) => {
    e.stopPropagation();
    handleRelease();
  }, [handleRelease]);

  const handleCardPointerMove = useCallback((e: any) => {
    if (!pointerActiveRef.current) return;
    // If useFrame XR tracking has taken over, skip R3F pointer events
    // (they use intersection-space coordinates that conflict with hand-position space)
    if (xrTrackingRef.current) return;
    e.stopPropagation();
    if (!e.point) return;

    const currentX = e.point.x;
    const currentY = e.point.y;
    const now = performance.now();
    const dt = (now - lastHandTimeRef.current) / 1000;

    const totalDeltaX = currentX - pointerStartXRef.current;
    const totalDeltaY = currentY - pointerStartYRef.current;

    // Direction lock: determine axis on first significant movement
    if (!isDraggingRef.current) {
      const absX = Math.abs(totalDeltaX);
      const absY = Math.abs(totalDeltaY);
      if (absX > CLICK_THRESHOLD || absY > CLICK_THRESHOLD) {
        isDraggingRef.current = true;
        // Check if the center card is flipped and scrollable for vertical drag
        const isCenterFlipped = flippedIndexRef.current === currentIndexRef.current && cardScrollMaxRef.current > 0;
        if (isCenterFlipped && absY > absX) {
          dragAxisRef.current = 'vertical';
        } else {
          dragAxisRef.current = 'horizontal';
        }
      }
    }

    if (isDraggingRef.current) {
      if (dragAxisRef.current === 'vertical') {
        // Card content scroll
        if (dt > 0.001) {
          const raw = (currentY - lastHandYRef.current) / dt;
          scrollVelocityRef.current = scrollVelocityRef.current * (1 - VELOCITY_SMOOTHING) + raw * VELOCITY_SMOOTHING;
        }
        cardScrollYRef.current = pointerStartScrollYRef.current + totalDeltaY * CARD_SCROLL_SENSITIVITY;
        cardScrollYRef.current = Math.max(0, Math.min(cardScrollMaxRef.current, cardScrollYRef.current));
      } else {
        // Carousel drag
        if (dt > 0.001) {
          const raw = (currentX - lastHandXRef.current) / dt;
          velocityRef.current = velocityRef.current * (1 - VELOCITY_SMOOTHING) + raw * VELOCITY_SMOOTHING;
        }
        scrollOffsetRef.current = pointerStartOffsetRef.current - totalDeltaX * DRAG_SENSITIVITY;
        scrollOffsetRef.current = Math.max(-0.3, Math.min(itemsRef.current.length - 0.7, scrollOffsetRef.current));
      }
    }
    lastHandXRef.current = currentX;
    lastHandYRef.current = currentY;
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

    // XR input tracking while pointer is held (skip if touch drag is active)
    if (pointerActiveRef.current && !touchDraggingRef.current) {
      let inputHandled = false;
      let currentHandX = lastHandXRef.current;
      let currentHandY = lastHandYRef.current;

      try {
        const gl = state.gl;
        const session = gl.xr.getSession();
        if (session) {
          const frame = gl.xr.getFrame();
          const refSpace = gl.xr.getReferenceSpace();

          let foundActiveGamepad = false;
          let hasGamepad = false;

          for (const source of session.inputSources) {
            // XR controller with gamepad (Quest, etc.)
            if (source.gamepad) {
              hasGamepad = true;
              if (source.gamepad.buttons[0]?.pressed) {
                foundActiveGamepad = true;
                inputHandled = true;
                if (frame && refSpace && source.targetRaySpace) {
                  const pose = frame.getPose(source.targetRaySpace, refSpace);
                  if (pose) {
                    // Project controller ray onto a plane at the card-arc distance
                    // so the "grabbed point" tracks 1:1 with the visual card position.
                    const o = pose.transform.orientation;
                    _quat.set(o.x, o.y, o.z, o.w);
                    _dir.set(0, 0, -1).applyQuaternion(_quat);
                    const planeZ = pos[2] - ARC_RADIUS;
                    const t = (planeZ - pose.transform.position.z) / _dir.z;
                    if (t > 0) {
                      currentHandX = pose.transform.position.x + t * _dir.x;
                      currentHandY = pose.transform.position.y + t * _dir.y;
                    } else {
                      // Fallback to raw hand position if ray is parallel/away
                      currentHandX = pose.transform.position.x;
                      currentHandY = pose.transform.position.y;
                    }
                  }
                }
                break; // Found the active controller, stop looking
              }
              continue; // This controller isn't pressing — check the other one
            }

            // Phone screen touch is handled by window-level touch events (useEffect above),
            // so we intentionally skip targetRayMode === 'screen' sources here.
          }

          // All gamepad controllers exist but none are pressing → release
          if (hasGamepad && !foundActiveGamepad) {
            handleRelease();
            inputHandled = true;
          }
        }
      } catch { /* ignore */ }

      if (inputHandled && pointerActiveRef.current) {
        // Mark that useFrame owns this gesture — disables R3F onPointerMove
        xrTrackingRef.current = true;

        if (needsStartCaptureRef.current) {
          pointerStartXRef.current = currentHandX;
          pointerStartYRef.current = currentHandY;
          lastHandXRef.current = currentHandX;
          lastHandYRef.current = currentHandY;
          pointerStartScrollYRef.current = cardScrollYRef.current;
          needsStartCaptureRef.current = false;
        } else {
          const now = performance.now();
          const dt = (now - lastHandTimeRef.current) / 1000;
          const totalDeltaX = currentHandX - pointerStartXRef.current;

          // VR controller drag: direction lock for carousel vs card scroll
          const totalDeltaY = currentHandY - pointerStartYRef.current;
          if (!isDraggingRef.current) {
            const absX = Math.abs(totalDeltaX);
            const absY = Math.abs(totalDeltaY);
            if (absX > CLICK_THRESHOLD || absY > CLICK_THRESHOLD) {
              isDraggingRef.current = true;
              const isCenterFlipped = flippedIndexRef.current === currentIndexRef.current && cardScrollMaxRef.current > 0;
              if (isCenterFlipped && absY > absX) {
                dragAxisRef.current = 'vertical';
              } else {
                dragAxisRef.current = 'horizontal';
              }
            }
          }
          if (isDraggingRef.current) {
            if (dragAxisRef.current === 'vertical') {
              if (dt > 0.001) {
                const raw = (currentHandY - lastHandYRef.current) / dt;
                scrollVelocityRef.current = scrollVelocityRef.current * (1 - VELOCITY_SMOOTHING) + raw * VELOCITY_SMOOTHING;
              }
              cardScrollYRef.current = pointerStartScrollYRef.current + totalDeltaY * CARD_SCROLL_SENSITIVITY;
              cardScrollYRef.current = Math.max(0, Math.min(cardScrollMaxRef.current, cardScrollYRef.current));
            } else {
              if (dt > 0.001) {
                const raw = (currentHandX - lastHandXRef.current) / dt;
                velocityRef.current = velocityRef.current * (1 - VELOCITY_SMOOTHING) + raw * VELOCITY_SMOOTHING;
              }
              scrollOffsetRef.current = pointerStartOffsetRef.current - totalDeltaX * DRAG_SENSITIVITY;
              scrollOffsetRef.current = Math.max(-0.3, Math.min(itms.length - 0.7, scrollOffsetRef.current));
            }
          }

          lastHandXRef.current = currentHandX;
          lastHandYRef.current = currentHandY;
          lastHandTimeRef.current = now;
        }
      }
    }

    // Carousel momentum / snap (skip while touch drag is active)
    if (!pointerActiveRef.current && !touchDraggingRef.current) {
      if (momentumRef.current !== 0) {
        scrollOffsetRef.current += momentumRef.current * delta * 60;
        momentumRef.current *= Math.pow(MOMENTUM_FRICTION, delta * 60);
        if (Math.abs(momentumRef.current) < 0.01) {
          momentumRef.current = 0;
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

    // Card scroll momentum
    if (!pointerActiveRef.current && scrollMomentumRef.current !== 0) {
      cardScrollYRef.current += scrollMomentumRef.current * delta * 60;
      scrollMomentumRef.current *= Math.pow(CARD_SCROLL_MOMENTUM_FRICTION, delta * 60);
      cardScrollYRef.current = Math.max(0, Math.min(cardScrollMaxRef.current, cardScrollYRef.current));
      if (Math.abs(scrollMomentumRef.current) < 1) {
        scrollMomentumRef.current = 0;
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

    // Update visible window center
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
              const thumbY = source.gamepad.axes[3];

              // Thumbstick X: carousel navigation
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

              // Thumbstick Y: card content scroll (when center card is flipped and scrollable)
              if (flippedIndexRef.current === target && cardScrollMaxRef.current > 0 && Math.abs(thumbY) > 0.2) {
                cardScrollYRef.current += thumbY * CARD_SCROLL_THUMBSTICK_SPEED * delta;
                cardScrollYRef.current = Math.max(0, Math.min(cardScrollMaxRef.current, cardScrollYRef.current));
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

  // Background catch-plane dimensions — covers the visible carousel arc + padding
  const bgW = 2 * ARC_RADIUS * Math.sin(((VISIBLE_CARDS + 2) / 2) * ARC_STEP); // arc chord width + 1 card padding each side
  const bgH = CARD_H * 2.0; // generous vertical padding

  return (
    <group position={position}>
      {/* Invisible drag catch-plane — sits just behind the card arc so cards get priority,
          but catches pointers that land between/around cards to start carousel drags */}
      <mesh
        position={[0, 0, -ARC_RADIUS - 0.02]}
        onPointerDown={handleBgPointerDown}
        onPointerUp={handleCardPointerUp}
      >
        <planeGeometry args={[bgW, bgH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

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
            cardScrollYRef={cardScrollYRef}
            cardScrollMaxRef={cardScrollMaxRef}
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
  cardScrollYRef: React.MutableRefObject<number>;
  cardScrollMaxRef: React.MutableRefObject<number>;
  onCardPointerDown: (cardIndex: number, e: any) => void;
  onCardPointerUp: (e: any) => void;
  onCardPointerMove: (e: any) => void;
  onCardPointerEnter: (cardIndex: number, e: any) => void;
  onCardPointerLeave: (cardIndex: number, e: any) => void;
}

const MemoCard = memo(function MemoCardInner({
  item, itemIndex, isFlipped, scrollOffsetRef, hoveredIndexRef,
  cardScrollYRef, cardScrollMaxRef,
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
      cardScrollYRef={cardScrollYRef}
      cardScrollMaxRef={cardScrollMaxRef}
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
