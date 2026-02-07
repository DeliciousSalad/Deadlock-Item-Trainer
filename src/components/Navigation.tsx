import { useRef, useCallback } from 'react';
import { hapticTap, hapticSuccess } from '../utils/haptics';

interface NavigationProps {
  currentIndex: number;
  total: number;
  currentType?: 'weapon' | 'vitality' | 'spirit';
  categoryFilter?: 'all' | 'weapon' | 'vitality' | 'spirit';
  onPrevious: () => void;
  onNext: () => void;
  onShuffle: () => void;
  onReset: () => void;
  onGoToEnd: () => void;
  onSeek?: (index: number) => void;
}

// Colors for each item type
const typeColors: Record<string, { fill: string; bg: string; border: string; text: string; hover: string }> = {
  weapon: { 
    fill: '#f59e0b', 
    bg: 'rgba(245, 158, 11, 0.3)', 
    border: 'rgba(245, 158, 11, 0.4)', 
    text: '#fcd34d',
    hover: 'rgba(245, 158, 11, 0.4)'
  },
  vitality: { 
    fill: '#10b981', 
    bg: 'rgba(16, 185, 129, 0.3)', 
    border: 'rgba(16, 185, 129, 0.4)', 
    text: '#6ee7b7',
    hover: 'rgba(16, 185, 129, 0.4)'
  },
  spirit: { 
    fill: '#8b5cf6', 
    bg: 'rgba(139, 92, 246, 0.3)', 
    border: 'rgba(139, 92, 246, 0.4)', 
    text: '#c4b5fd',
    hover: 'rgba(139, 92, 246, 0.4)'
  },
  all: { 
    fill: '#f7e6cc', 
    bg: 'rgba(247, 230, 204, 0.2)', 
    border: 'rgba(247, 230, 204, 0.3)', 
    text: '#f7e6cc',
    hover: 'rgba(247, 230, 204, 0.3)'
  },
};

export function Navigation({
  currentIndex,
  total,
  currentType: _currentType,
  categoryFilter = 'all',
  onPrevious,
  onNext,
  onShuffle,
  onReset,
  onGoToEnd,
  onSeek,
}: NavigationProps) {
  const progress = ((currentIndex + 1) / total) * 100;
  // Use category filter color if filtering by type, otherwise use neutral color for 'all'
  const colors = categoryFilter !== 'all' 
    ? typeColors[categoryFilter] 
    : typeColors.all;
  const progressBarRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastSeekedIndexRef = useRef(currentIndex); // Track last seeked index to avoid stale closures
  
  // Calculate index from position on progress bar
  // Account for thumb width (20px) - thumb moves from 0 to (width - 20px)
  const getIndexFromPosition = useCallback((clientX: number): number => {
    if (!progressBarRef.current || total === 0) return 0;
    const rect = progressBarRef.current.getBoundingClientRect();
    const thumbWidth = 20;
    const effectiveWidth = rect.width - thumbWidth;
    // Offset by half thumb width so clicking thumb center maps correctly
    const x = clientX - rect.left - (thumbWidth / 2);
    const percentage = Math.max(0, Math.min(1, x / effectiveWidth));
    return Math.round(percentage * (total - 1));
  }, [total]);
  
  // Handle drag start (mousedown initiates dragging, no separate click handler needed)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!onSeek) return;
    e.preventDefault(); // Prevent text selection during drag
    isDraggingRef.current = true;
    
    const newIndex = getIndexFromPosition(e.clientX);
    lastSeekedIndexRef.current = newIndex;
    hapticTap();
    onSeek(newIndex);
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const newIndex = getIndexFromPosition(moveEvent.clientX);
      if (newIndex !== lastSeekedIndexRef.current) {
        lastSeekedIndexRef.current = newIndex;
        onSeek(newIndex);
      }
    };
    
    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [onSeek, getIndexFromPosition]);
  
  // Handle touch
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!onSeek || e.touches.length !== 1) return;
    isDraggingRef.current = true;
    
    const newIndex = getIndexFromPosition(e.touches[0].clientX);
    lastSeekedIndexRef.current = newIndex;
    hapticTap();
    onSeek(newIndex);
  }, [onSeek, getIndexFromPosition]);
  
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!onSeek || !isDraggingRef.current || e.touches.length !== 1) return;
    const newIndex = getIndexFromPosition(e.touches[0].clientX);
    if (newIndex !== lastSeekedIndexRef.current) {
      lastSeekedIndexRef.current = newIndex;
      onSeek(newIndex);
    }
  }, [onSeek, getIndexFromPosition]);
  
  const handleTouchEnd = useCallback(() => {
    isDraggingRef.current = false;
  }, []);
  
  return (
    <div className="flex flex-col items-center gap-1.5 w-full max-w-md mx-auto px-1">
      {/* Progress indicator and bar - interactive slider with text inside */}
      <div 
        ref={progressBarRef}
        className="w-full h-6 bg-white/10 rounded-full overflow-hidden cursor-pointer relative"
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: 'none' }}
      >
        {/* Progress fill - extends to thumb center, color matches current card type */}
        <div
          className="h-full pointer-events-none absolute left-0 top-0 rounded-full"
          style={{ 
            width: progress > 0 ? `calc((100% - 20px) * ${progress / 100} + 22px)` : '0',
            maxWidth: '100%',
            background: colors.fill,
            transition: isDraggingRef.current ? 'none' : 'width 0.15s ease-out, background 0.3s ease-out',
          }}
        />
        {/* Thumb indicator - behind text, clamped to bar bounds */}
        <div 
          className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full shadow-lg pointer-events-none border-2 border-white/50"
          style={{ 
            left: `calc((100% - 20px) * ${progress / 100})`,
            transition: isDraggingRef.current ? 'none' : 'left 0.15s ease-out',
            zIndex: 1,
          }}
        />
        {/* Text overlay - centered, on top */}
        <div 
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 2 }}
        >
          <span className="text-sm font-bold font-mono" style={{ 
            color: '#ffffff',
            textShadow: '0 1px 3px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)',
          }}>
            {currentIndex + 1} / {total}
          </span>
        </div>
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-2 justify-center w-full">
        {/* Go to Start */}
        <button
          onClick={() => { hapticSuccess(); onReset(); }}
          disabled={currentIndex === 0}
          className="px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white/80 font-semibold
                     hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed
                     transition-all duration-200 flex items-center justify-center"
          title="Go to Start"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>

        {/* Previous */}
        <button
          onClick={() => { hapticTap(); onPrevious(); }}
          disabled={currentIndex === 0}
          className="flex-1 max-w-24 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white font-semibold
                     hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed
                     transition-all duration-200 flex items-center justify-center gap-1.5"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Shuffle */}
        <button
          onClick={() => { hapticSuccess(); onShuffle(); }}
          className="px-4 py-3 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-1.5"
          style={{
            background: colors.bg,
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: colors.border,
            color: colors.text,
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = colors.hover}
          onMouseLeave={(e) => e.currentTarget.style.background = colors.bg}
          title="Shuffle"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="text-sm">Shuffle</span>
        </button>

        {/* Next */}
        <button
          onClick={() => { hapticTap(); onNext(); }}
          disabled={currentIndex === total - 1}
          className="flex-1 max-w-24 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white font-semibold
                     hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed
                     transition-all duration-200 flex items-center justify-center gap-1.5"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Go to End */}
        <button
          onClick={() => { hapticSuccess(); onGoToEnd(); }}
          disabled={currentIndex === total - 1}
          className="px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white/80 font-semibold
                     hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed
                     transition-all duration-200 flex items-center justify-center"
          title="Go to End"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Keyboard hints - hidden on mobile */}
      <p className="hidden sm:flex text-white/30 text-xs items-center gap-2">
        <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-white/50 text-xs">←</kbd>
        <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-white/50 text-xs">→</kbd>
        <span>navigate</span>
        <span className="text-white/20">•</span>
        <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded text-white/50 text-xs">Space</kbd>
        <span>flip</span>
      </p>
    </div>
  );
}
