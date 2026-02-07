import { useRef, useEffect, useCallback, useMemo, useState, useImperativeHandle, forwardRef } from 'react';
import { Flashcard } from './Flashcard';
import type { ProcessedItem } from '../types';
import { hapticTap } from '../utils/haptics';
import { preloadImage } from '../utils/itemProcessing';
import { playActiveSound } from '../utils/sounds';

export interface CardCarouselHandle {
  scrollToIndex: (index: number, instant?: boolean) => void;
}

// Custom eased scroll animation with cancellation support
let currentAnimationId: number | null = null;

function cancelSmoothScroll() {
  if (currentAnimationId !== null) {
    cancelAnimationFrame(currentAnimationId);
    currentAnimationId = null;
  }
}

function smoothScrollTo(
  element: HTMLElement, 
  targetX: number, 
  duration: number = 400,
  onComplete?: () => void
) {
  // Cancel any existing animation
  cancelSmoothScroll();
  
  const startX = element.scrollLeft;
  const distance = targetX - startX;
  const startTime = performance.now();
  
  // Ease-out cubic for smooth deceleration
  const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
  
  function animate(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easedProgress = easeOutCubic(progress);
    
    element.scrollLeft = startX + (distance * easedProgress);
    
    if (progress < 1) {
      currentAnimationId = requestAnimationFrame(animate);
    } else {
      currentAnimationId = null;
      if (onComplete) {
        onComplete();
      }
    }
  }
  
  currentAnimationId = requestAnimationFrame(animate);
}

interface CardCarouselProps {
  items: ProcessedItem[];
  currentIndex: number;
  onIndexChange: (index: number) => void;
  flippedIndex: number | null;
  onFlip: (index: number) => void;
}

export const CardCarousel = forwardRef<CardCarouselHandle, CardCarouselProps>(function CardCarousel({ 
  items, 
  currentIndex, 
  onIndexChange, 
  flippedIndex,
  onFlip
}, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  // Use a counter instead of boolean to handle overlapping programmatic scrolls
  const programmaticScrollCountRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastIndexRef = useRef(currentIndex);
  // Track when user is interacting - prevents useEffect from interfering
  const userInteractionRef = useRef(false);
  // Track timestamp of last scroll-initiated index change
  const lastScrollChangeTimeRef = useRef(0);
  
  // Track container width for dynamic render window
  const [containerWidth, setContainerWidth] = useState(0);
  
  // Image cache - loads images as they come into view
  const [loadedImages, setLoadedImages] = useState<Map<number, string>>(new Map());
  const loadingImagesRef = useRef<Set<number>>(new Set());
  
  // Track scroll-based visible range (updates during scrolling)
  const [scrollVisibleRange, setScrollVisibleRange] = useState({ start: 0, end: 4 });
  
  // Initialize scroll visible range when items change
  useEffect(() => {
    if (items.length > 0) {
      // Set initial range based on current index with larger buffer
      const buffer = 6;
      setScrollVisibleRange({
        start: Math.max(0, currentIndex - buffer),
        end: Math.min(items.length - 1, currentIndex + buffer)
      });
    }
  }, [items.length]); // Only on items change, not currentIndex
  
  // Observe container size changes
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    
    const updateWidth = () => {
      // Use the actual container width for consistency with scroll calculations
      if (scrollRef.current) {
        setContainerWidth(scrollRef.current.offsetWidth);
      }
    };
    
    // Initial measurement after a short delay to ensure layout is complete
    const timer = setTimeout(updateWidth, 50);
    
    // Use ResizeObserver for responsive updates
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(container);
    
    return () => {
      clearTimeout(timer);
      resizeObserver.disconnect();
    };
  }, []);
  
  // Calculate render window based on container width
  const renderWindow = useMemo(() => {
    if (containerWidth === 0) return 4; // Default before measurement
    
    const cardWidth = Math.min(containerWidth * 0.70, 300);
    const gap = 16;
    
    // How many cards fit in the viewport (approximately)
    const visibleCards = Math.ceil(containerWidth / (cardWidth + gap));
    
    // Add buffer of 2-3 cards on each side for smooth scrolling and flip animations
    return Math.max(3, Math.ceil(visibleCards / 2) + 3);
  }, [containerWidth]);
  
  // Calculate spacer width to center first/last cards
  // spacer = (container - cardWidth) / 2 - gap
  // cardWidth = min(70%, 300px)
  // Use JavaScript when containerWidth is known, CSS calc as fallback
  const spacerWidth = useMemo(() => {
    if (containerWidth > 0) {
      const cardWidth = Math.min(containerWidth * 0.70, 300);
      const spacer = (containerWidth - cardWidth) / 2 - 16;
      return `${Math.max(0, spacer)}px`;
    }
    // Fallback to CSS calc for initial render
    return 'calc(max(0px, (100% - min(70%, 300px)) / 2 - 16px))';
  }, [containerWidth]);
  
  // Mouse/touch drag state
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const scrollStartRef = useRef(0);
  const hasDraggedRef = useRef(false); // Track if actually dragged (vs just clicked)
  const blockClicksUntilRef = useRef(0); // Timestamp until clicks should be blocked
  const isTouchRef = useRef(false); // Track if current interaction is touch
  
  // Velocity tracking for desktop momentum scrolling
  const lastMouseXRef = useRef(0);
  const lastMouseTimeRef = useRef(0);
  const velocityRef = useRef(0);
  
  // Track text click timing for distinguishing quick tap vs text selection
  const textClickStartTimeRef = useRef(0);
  const textClickBlockFlipRef = useRef(false);

  // Center card at current index
  const scrollToIndexFn = useCallback((index: number, smooth: boolean = true) => {
    const cardElement = cardRefs.current.get(index);
    const container = scrollRef.current;
    if (cardElement && container) {
      // Cancel any ongoing smooth animation
      cancelSmoothScroll();
      
      const cardLeft = cardElement.offsetLeft;
      const cardWidth = cardElement.offsetWidth;
      const containerWidth = container.offsetWidth;
      const scrollTarget = cardLeft - (containerWidth / 2) + (cardWidth / 2);
      
      if (smooth) {
        smoothScrollTo(container, scrollTarget, 200);
      } else {
        // Direct assignment for instant scroll
        container.scrollLeft = scrollTarget;
      }
    }
  }, []);

  // Expose scrollToIndex via ref for external control (e.g., seek slider)
  useImperativeHandle(ref, () => ({
    scrollToIndex: (index: number, instant: boolean = false) => {
      // Update lastIndexRef to prevent the regular currentIndex effect from firing
      lastIndexRef.current = index;
      
      // Clear any pending sound feedback from previous scrolling
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = undefined;
      }
      pendingFeedbackRef.current = null;
      
      // Mark as programmatic to prevent handleScroll from interfering
      programmaticScrollCountRef.current++;
      // Decrement after a delay to allow scroll events to fire
      // Use shorter timeout for instant scrolls, longer for smooth scrolls
      setTimeout(() => {
        programmaticScrollCountRef.current = Math.max(0, programmaticScrollCountRef.current - 1);
      }, instant ? 100 : 250);
      
      scrollToIndexFn(index, !instant); // smooth = !instant
    }
  }), [scrollToIndexFn]);

  // Re-center current card when container width changes (e.g., window resize)
  // Skip the very first render to avoid fighting with initial layout
  const hasInitializedRef = useRef(false);
  useEffect(() => {
    if (containerWidth > 0) {
      if (hasInitializedRef.current) {
        // Re-center after resize
        const timer = setTimeout(() => {
          scrollToIndexFn(currentIndex, false);
        }, 50);
        return () => clearTimeout(timer);
      } else {
        hasInitializedRef.current = true;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth]); // Re-center when container size changes

  // Scroll to current index when it changes externally (from nav buttons)
  useEffect(() => {
    // Only scroll if index actually changed from what we last knew
    if (currentIndex === lastIndexRef.current) return;
    
    // If this change came from recent scrolling (within 200ms), skip the scroll and sound
    const timeSinceScrollChange = Date.now() - lastScrollChangeTimeRef.current;
    if (timeSinceScrollChange < 200) {
      lastIndexRef.current = currentIndex;
      return;
    }
    
    // IMMEDIATELY update lastIndexRef and increment programmatic counter
    // This prevents handleScroll from seeing the change and queuing duplicate sounds
    lastIndexRef.current = currentIndex;
    programmaticScrollCountRef.current++;
    
    // External navigation - clear interaction state
    userInteractionRef.current = false;
    cancelSmoothScroll(); // Cancel any ongoing user-initiated animation
    
    // Clear any pending sound feedback from previous scrolling
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = undefined;
    }
    pendingFeedbackRef.current = null;
    
    // Note: No sound here - clicking inactive cards is silent to avoid Safari double-play issues

    const cardElement = cardRefs.current.get(currentIndex);
    const container = scrollRef.current;
    if (cardElement && container) {
      // Calculate scroll position to center the card
      const cardLeft = cardElement.offsetLeft;
      const cardWidth = cardElement.offsetWidth;
      const containerWidth = container.offsetWidth;
      const scrollTarget = cardLeft - (containerWidth / 2) + (cardWidth / 2);
      
      smoothScrollTo(container, scrollTarget, 200, () => {
        programmaticScrollCountRef.current = Math.max(0, programmaticScrollCountRef.current - 1);
      });
    } else {
      // No scroll needed, decrement counter
      programmaticScrollCountRef.current = Math.max(0, programmaticScrollCountRef.current - 1);
    }
  }, [currentIndex]);

  // Find which card is closest to center
  const findCenteredCardIndex = useCallback(() => {
    if (!scrollRef.current) return currentIndex;
    
    const container = scrollRef.current;
    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.left + containerRect.width / 2;
    
    let closestIndex = 0;
    let closestDistance = Infinity;
    
    cardRefs.current.forEach((cardElement, index) => {
      const cardRect = cardElement.getBoundingClientRect();
      const cardCenter = cardRect.left + cardRect.width / 2;
      const distance = Math.abs(cardCenter - containerCenter);
      
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    
    return closestIndex;
  }, [currentIndex]);

  // Calculate visible range from current scroll position
  const calculateScrollVisibleRange = useCallback(() => {
    const container = scrollRef.current;
    if (!container || items.length === 0) return { start: 0, end: Math.min(6, items.length - 1) };
    
    const scrollLeft = container.scrollLeft;
    const containerWidth = container.offsetWidth;
    const buffer = renderWindow + 2; // Extra buffer for early loading
    
    // Find first visible card
    let firstVisible = 0;
    let lastVisible = items.length - 1;
    
    for (let i = 0; i < items.length; i++) {
      const card = cardRefs.current.get(i);
      if (card) {
        const cardRight = card.offsetLeft + card.offsetWidth;
        if (cardRight > scrollLeft - containerWidth) {
          firstVisible = i;
          break;
        }
      }
    }
    
    // Find last visible card
    for (let i = items.length - 1; i >= 0; i--) {
      const card = cardRefs.current.get(i);
      if (card) {
        const cardLeft = card.offsetLeft;
        if (cardLeft < scrollLeft + containerWidth * 2) {
          lastVisible = i;
          break;
        }
      }
    }
    
    return {
      start: Math.max(0, firstVisible - buffer),
      end: Math.min(items.length - 1, lastVisible + buffer)
    };
  }, [items.length, renderWindow]);

  // Throttle scroll handling with requestAnimationFrame
  const scrollRafRef = useRef<number | null>(null);
  const lastVisibleRangeUpdateRef = useRef(0);
  const pendingFeedbackRef = useRef<string | null>(null); // Track pending haptic/sound
  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  
  // Handle scroll events (only for user-initiated scrolls)
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    
    // Cancel pending RAF to avoid stacking
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      if (!scrollRef.current) return;
      
      // Throttle visible range updates to every 150ms
      const now = Date.now();
      if (now - lastVisibleRangeUpdateRef.current > 150) {
        lastVisibleRangeUpdateRef.current = now;
        const newRange = calculateScrollVisibleRange();
        setScrollVisibleRange(prev => {
          if (prev.start !== newRange.start || prev.end !== newRange.end) {
            return newRange;
          }
          return prev;
        });
      }
      
      // Skip index updates during programmatic scrolling
      if (programmaticScrollCountRef.current > 0) return;
      
      // Update active card based on scroll position in real-time
      const centeredIndex = findCenteredCardIndex();
      if (centeredIndex !== lastIndexRef.current) {
        lastIndexRef.current = centeredIndex;
        lastScrollChangeTimeRef.current = now;
        
        // Defer haptic/sound feedback to avoid jank during fast scrolling
        // Only play when scrolling settles (no new changes for 80ms)
        pendingFeedbackRef.current = items[centeredIndex]?.type || null;
        if (feedbackTimeoutRef.current) {
          clearTimeout(feedbackTimeoutRef.current);
        }
        feedbackTimeoutRef.current = setTimeout(() => {
          if (pendingFeedbackRef.current) {
            hapticTap();
            playActiveSound(pendingFeedbackRef.current);
            pendingFeedbackRef.current = null;
          }
        }, 80);
        
        onIndexChange(centeredIndex);
      }
    });
  }, [findCenteredCardIndex, onIndexChange, calculateScrollVisibleRange, items]);

  // Cleanup timeouts and RAF on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  // Set card ref
  const setCardRef = useCallback((index: number, element: HTMLDivElement | null) => {
    if (element) {
      cardRefs.current.set(index, element);
    } else {
      cardRefs.current.delete(index);
    }
  }, []);

  // Check if element or its parents contain selectable text
  const isOverSelectableText = useCallback((target: EventTarget | null): boolean => {
    if (!target || !(target instanceof HTMLElement)) return false;
    
    // Check if target or any parent is a text-containing element
    let el: HTMLElement | null = target;
    while (el && el !== scrollRef.current) {
      const tagName = el.tagName.toLowerCase();
      // Allow text selection in paragraphs, spans, headings, labels, etc.
      if (['p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label', 'a'].includes(tagName)) {
        // Check if it has actual text content
        if (el.textContent && el.textContent.trim().length > 0) {
          return true;
        }
      }
      el = el.parentElement;
    }
    return false;
  }, []);

  // Mouse drag handlers for desktop - simulate touch-like scrolling with momentum
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!scrollRef.current) return;
    
    // Don't start drag if clicking on selectable text
    if (isOverSelectableText(e.target)) {
      textClickStartTimeRef.current = Date.now();
      textClickBlockFlipRef.current = false; // Will be set on mouseup if selection detected
      return;
    }
    textClickStartTimeRef.current = 0;
    
    // Don't cancel scroll or set interaction flags yet - wait for actual drag
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartXRef.current = e.clientX;
    scrollStartRef.current = scrollRef.current.scrollLeft;
    
    // Initialize velocity tracking
    lastMouseXRef.current = e.clientX;
    lastMouseTimeRef.current = performance.now();
    velocityRef.current = 0;
    
    // Don't disable text selection yet - wait until actual drag is detected
    scrollRef.current.style.cursor = 'grabbing';
  }, [isOverSelectableText]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDraggingRef.current || !scrollRef.current) return;
    
    const deltaX = dragStartXRef.current - e.clientX;
    
    // Only consider it a drag if moved more than 5px
    if (Math.abs(deltaX) > 5) {
      if (!hasDraggedRef.current) {
        // First time detecting drag - now cancel scroll and take control
        hasDraggedRef.current = true;
        cancelSmoothScroll();
        programmaticScrollCountRef.current = 0;
        userInteractionRef.current = true;
        scrollRef.current.style.userSelect = 'none';
        document.body.style.userSelect = 'none';
      }
      e.preventDefault();
    }
    
    // Only scroll if we're actually dragging
    if (!hasDraggedRef.current) return;
    
    // Track velocity for momentum
    const now = performance.now();
    const dt = now - lastMouseTimeRef.current;
    if (dt > 0) {
      const dx = lastMouseXRef.current - e.clientX;
      velocityRef.current = dx / dt; // pixels per millisecond
    }
    lastMouseXRef.current = e.clientX;
    lastMouseTimeRef.current = now;
    
    // Direct 1:1 movement
    scrollRef.current.scrollLeft = scrollStartRef.current + deltaX;
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!scrollRef.current) return;
    
    // Check if this was a text selection attempt (not a quick tap)
    if (textClickStartTimeRef.current > 0) {
      const clickDuration = Date.now() - textClickStartTimeRef.current;
      const hasSelection = window.getSelection()?.toString().length ?? 0 > 0;
      
      // If held for >200ms OR text was selected, block the flip
      if (clickDuration > 200 || hasSelection) {
        textClickBlockFlipRef.current = true;
      }
      textClickStartTimeRef.current = 0;
    }
    
    const wasDragging = isDraggingRef.current && hasDraggedRef.current;
    const velocity = velocityRef.current;
    isDraggingRef.current = false;
    scrollRef.current.style.cursor = '';
    scrollRef.current.style.userSelect = '';
    document.body.style.userSelect = ''; // Restore text selection
    
    // If we actually dragged, apply momentum then snap
    if (wasDragging) {
      blockClicksUntilRef.current = Date.now() + 800;
      
      const container = scrollRef.current;
      const startScroll = container.scrollLeft;
      
      // Calculate momentum distance based on velocity
      // velocity is in px/ms, we want a natural deceleration
      const momentum = velocity * 150; // Adjust multiplier for feel
      const targetScroll = startScroll + momentum;
      
      // Temporarily set scroll to target to find which card we'll land on
      container.scrollLeft = targetScroll;
      const targetIndex = findCenteredCardIndex();
      container.scrollLeft = startScroll; // Restore
      
      // Get the target card's snap position
      // handleScroll will update the active card as we scroll
      const cardElement = cardRefs.current.get(targetIndex);
      if (cardElement) {
        const cardLeft = cardElement.offsetLeft;
        const cardWidth = cardElement.offsetWidth;
        const containerWidth = container.offsetWidth;
        const snapTarget = cardLeft - (containerWidth / 2) + (cardWidth / 2);
        
        // Animate directly to the snap position with easing
        smoothScrollTo(container, snapTarget, 250, () => {
          userInteractionRef.current = false;
        });
      } else {
        userInteractionRef.current = false;
      }
    } else {
      // No drag, just a click - clear interaction flag
      userInteractionRef.current = false;
    }
  }, [findCenteredCardIndex]);
  
  // Wrapper for onFlip that prevents flips during/after drag or text selection
  const handleCardFlip = useCallback((index: number) => {
    // Don't flip if we just finished dragging
    if (Date.now() < blockClicksUntilRef.current) return;
    // Don't flip if we were selecting text (held or selected)
    if (textClickBlockFlipRef.current) {
      textClickBlockFlipRef.current = false;
      return;
    }
    onFlip(index);
  }, [onFlip]);

  // Touch event handlers for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!scrollRef.current || e.touches.length !== 1) return;
    
    // Don't cancel scroll or set interaction flags yet - wait for actual drag
    isTouchRef.current = true;
    isDraggingRef.current = true;
    hasDraggedRef.current = false;
    dragStartXRef.current = e.touches[0].clientX;
    scrollStartRef.current = scrollRef.current.scrollLeft;
    
    // Track velocity for touch like we do for mouse
    lastMouseXRef.current = e.touches[0].clientX;
    lastMouseTimeRef.current = performance.now();
    velocityRef.current = 0;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDraggingRef.current || !isTouchRef.current || !scrollRef.current) return;
    if (e.touches.length !== 1) return;
    
    const deltaX = dragStartXRef.current - e.touches[0].clientX;
    
    if (Math.abs(deltaX) > 5) {
      if (!hasDraggedRef.current) {
        // First time detecting drag - now cancel scroll and take control
        hasDraggedRef.current = true;
        cancelSmoothScroll();
        programmaticScrollCountRef.current = 0;
        userInteractionRef.current = true;
      }
    }
    
    // Track velocity for momentum prediction
    const now = performance.now();
    const dt = now - lastMouseTimeRef.current;
    if (dt > 0) {
      const dx = lastMouseXRef.current - e.touches[0].clientX;
      velocityRef.current = dx / dt; // pixels per millisecond
    }
    lastMouseXRef.current = e.touches[0].clientX;
    lastMouseTimeRef.current = now;
    // Let native scrolling handle the movement
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!scrollRef.current || !isTouchRef.current) return;
    
    const wasDragging = isDraggingRef.current && hasDraggedRef.current;
    isDraggingRef.current = false;
    isTouchRef.current = false;
    
    // Block clicks briefly after drag
    if (wasDragging) {
      blockClicksUntilRef.current = Date.now() + 300;
      
      // Wait for native momentum to settle, then snap to nearest card
      let lastScrollLeft = scrollRef.current.scrollLeft;
      let stableCount = 0;
      
      const checkAndSnap = () => {
        if (!scrollRef.current) {
          userInteractionRef.current = false;
          return;
        }
        
        const currentScrollLeft = scrollRef.current.scrollLeft;
        const scrollDelta = Math.abs(currentScrollLeft - lastScrollLeft);
        lastScrollLeft = currentScrollLeft;
        
        // If scroll velocity is very low, increment stable counter
        if (scrollDelta < 2) {
          stableCount++;
        } else {
          stableCount = 0; // Reset if still moving
        }
        
        // After 2 stable readings (~100ms), snap to centered card
        if (stableCount >= 2) {
          const centeredIndex = findCenteredCardIndex();
          const cardElement = cardRefs.current.get(centeredIndex);
          if (cardElement && scrollRef.current) {
            const cardLeft = cardElement.offsetLeft;
            const cardWidth = cardElement.offsetWidth;
            const containerWidth = scrollRef.current.offsetWidth;
            const snapTarget = cardLeft - (containerWidth / 2) + (cardWidth / 2);
            
            smoothScrollTo(scrollRef.current, snapTarget, 150, () => {
              userInteractionRef.current = false;
            });
          } else {
            userInteractionRef.current = false;
          }
        } else {
          // Keep checking
          setTimeout(checkAndSnap, 50);
        }
      };
      
      // Start checking after a short delay
      setTimeout(checkAndSnap, 50);
    } else {
      // No drag, just a tap - clear interaction flag
      userInteractionRef.current = false;
    }
  }, [findCenteredCardIndex]);

  const handleMouseLeave = useCallback(() => {
    if (isDraggingRef.current) {
      handleMouseUp();
    }
  }, [handleMouseUp]);

  // Track previous index to keep cards loaded during transitions
  const prevIndexRef = useRef(currentIndex);
  const transitionIndexRef = useRef<number | null>(null);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, forceUpdate] = useState(0); // Used to trigger re-render when transition ends
  
  // Detect index change synchronously during render
  if (currentIndex !== prevIndexRef.current) {
    // Store the previous index for the transition period
    transitionIndexRef.current = prevIndexRef.current;
    prevIndexRef.current = currentIndex;
    
    // Clear any existing timeout
    if (transitionTimeoutRef.current) {
      clearTimeout(transitionTimeoutRef.current);
    }
    
    // Schedule cleanup after animation completes
    transitionTimeoutRef.current = setTimeout(() => {
      transitionIndexRef.current = null;
      forceUpdate(n => n + 1); // Trigger re-render to update visible range
    }, 600);
  }
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  // Calculate which indices should render full cards vs placeholders
  // Include both current and transition positions during animations
  const visibleRange = useMemo(() => {
    let start = currentIndex - renderWindow;
    let end = currentIndex + renderWindow;
    
    // Expand range to include transition position if animating
    const transitionIndex = transitionIndexRef.current;
    if (transitionIndex !== null) {
      start = Math.min(start, transitionIndex - renderWindow);
      end = Math.max(end, transitionIndex + renderWindow);
    }
    
    return {
      start: Math.max(0, start),
      end: Math.min(items.length - 1, end)
    };
  }, [currentIndex, items.length, renderWindow]);

  // Load images for scroll-visible items, unload images for non-visible items
  useEffect(() => {
    const visibleIds = new Set<number>();
    
    // Collect IDs of scroll-visible items
    for (let i = scrollVisibleRange.start; i <= scrollVisibleRange.end; i++) {
      if (items[i]) {
        visibleIds.add(items[i].id);
      }
    }
    
    // Load images for visible items that aren't already loaded or loading
    for (let i = scrollVisibleRange.start; i <= scrollVisibleRange.end; i++) {
      const item = items[i];
      if (!item) continue;
      
      if (!loadedImages.has(item.id) && !loadingImagesRef.current.has(item.id)) {
        loadingImagesRef.current.add(item.id);
        preloadImage(item.image).then((result) => {
          loadingImagesRef.current.delete(item.id);
          if (result) {
            setLoadedImages(prev => new Map(prev).set(item.id, result));
          }
        });
      }
    }
    
    // Unload images that are no longer visible
    setLoadedImages(prev => {
      const next = new Map<number, string>();
      prev.forEach((value, key) => {
        if (visibleIds.has(key)) {
          next.set(key, value);
        }
      });
      return next.size !== prev.size ? next : prev;
    });
  }, [scrollVisibleRange, items, loadedImages]);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        display: 'flex',
        overflowX: 'auto',
        overflowY: 'hidden',
        // No scroll-snap - we handle snapping ourselves with smoothScrollTo
        scrollBehavior: 'auto',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-x pan-y', // Allow native touch scrolling
        width: '100%',
        height: '100%',
        gap: '16px',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        cursor: 'grab',
      }}
      className="hide-scrollbar"
    >
      {/* Spacer to center first card */}
      <div style={{ flexShrink: 0, width: spacerWidth }} aria-hidden="true" />
      
      {items.map((item, index) => {
        // Use scroll-based visibility for rendering (combines both ranges for safety)
        const isInWindow = (index >= visibleRange.start && index <= visibleRange.end) ||
                          (index >= scrollVisibleRange.start && index <= scrollVisibleRange.end);
        
        // Common container styles for consistent scroll positioning
        const isActive = index === currentIndex;
        const containerStyle: React.CSSProperties = {
          flexShrink: 0,
          width: '70%',
          maxWidth: '300px',
          height: '100%',
          opacity: isActive ? 1 : 0.6,
          transform: isActive ? 'scale(1)' : 'scale(0.92)',
          // Minimal transition - just enough to not be jarring
          transition: 'opacity 0.1s, transform 0.1s',
        };
        
        // Render placeholder for items outside the visible window
        if (!isInWindow) {
          return (
            <div
              key={item.id}
              ref={(el) => setCardRef(index, el)}
              style={containerStyle}
            >
              {/* Empty placeholder - maintains scroll position without heavy DOM */}
            </div>
          );
        }
        
        // Apply cached image if available
        const itemWithCache = {
          ...item,
          image: loadedImages.get(item.id) || item.image
        };
        
        return (
          <div
            key={item.id}
            ref={(el) => setCardRef(index, el)}
            style={containerStyle}
          >
            <Flashcard
              item={itemWithCache}
              showAnswer={flippedIndex === index}
              onFlip={() => handleCardFlip(index)}
              isImageLoaded={loadedImages.has(item.id)}
              isActive={index === currentIndex}
            />
          </div>
        );
      })}
      
      {/* Spacer to center last card */}
      <div style={{ flexShrink: 0, width: spacerWidth }} aria-hidden="true" />
    </div>
  );
});
