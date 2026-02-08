import { useState, useEffect, useCallback, useRef } from 'react';
import { FilterBar } from './components/FilterBar';
import type { SortOption } from './components/FilterBar';
import { Navigation } from './components/Navigation';
import { MusicPlayer } from './components/MusicPlayer';
import { IntroScreen } from './components/IntroScreen';
import { CardCarousel, type CardCarouselHandle } from './components/CardCarousel';
import { XRButton } from './components/xr/XRButton';
import { XRScene } from './components/xr/XRScene';
import type { ProcessedItem, ComponentItem, ItemCategory, RawItem } from './types';

import { ITEMS_API_URL } from './constants';
import { 
  formatName, 
  determineType, 
  determineTier, 
  extractCost,
  extractStats,
  extractDescriptions,
  extractContentBlocks
} from './utils/itemProcessing';
import { playActiveSound, playFlipSound } from './utils/sounds';

function App() {
  // Track if user has started the app (clicked through intro)
  const [hasStarted, setHasStarted] = useState(false);
  
  const [items, setItems] = useState<ProcessedItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<ProcessedItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flippedIndex, setFlippedIndex] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patchDate, setPatchDate] = useState<string | null>(null);
  
  // Ref for carousel to enable direct scroll control (for seek slider)
  const carouselRef = useRef<CardCarouselHandle>(null);
  
  // Filters
  const [category, setCategory] = useState<ItemCategory>('all');
  const [tier, setTier] = useState<number | null>(null);
  const [sort, setSort] = useState<SortOption>('default');

  // XR mode
  const [xrActive, setXrActive] = useState(false);

  // Listen for XR session end to return to 2D UI.
  // Key: only react to session=null AFTER a session has been confirmed,
  // to avoid a race condition where enterAR() hasn't completed yet on re-entry.
  useEffect(() => {
    if (!xrActive) return;

    let unsubscribeStore: (() => void) | undefined;
    let sessionConfirmed = false;
    let endListenerSession: XRSession | null = null;
    const onEnd = () => setXrActive(false);

    import('./components/xr/xrStore').then(({ xrStore }) => {
      // Check if a session already exists (fast re-subscribe)
      const existing = xrStore.getState().session;
      if (existing) {
        sessionConfirmed = true;
        endListenerSession = existing;
        existing.addEventListener('end', onEnd);
      }

      // Watch for store state changes
      unsubscribeStore = xrStore.subscribe((state: any) => {
        if (state.session && !sessionConfirmed) {
          // Session just appeared — attach end listener & mark confirmed
          sessionConfirmed = true;
          endListenerSession = state.session;
          state.session.addEventListener('end', onEnd);
        } else if (!state.session && sessionConfirmed) {
          // Session went away after being confirmed — exit XR
          setXrActive(false);
        }
      });
    });

    return () => {
      unsubscribeStore?.();
      if (endListenerSession) {
        endListenerSession.removeEventListener('end', onEnd);
      }
    };
  }, [xrActive]);

  // When returning from XR, scroll the 2D carousel to the current active card
  const prevXrActiveRef = useRef(xrActive);
  useEffect(() => {
    if (prevXrActiveRef.current && !xrActive) {
      // XR just ended — jump carousel to current card after a brief delay
      // to let the hidden 2D UI become visible and layout
      setTimeout(() => {
        carouselRef.current?.scrollToIndex(currentIndex, true);
      }, 50);
    }
    prevXrActiveRef.current = xrActive;
  }, [xrActive, currentIndex]);

  // Wrapper to reset sort if it becomes redundant when changing category
  const handleCategoryChange = useCallback((newCategory: ItemCategory) => {
    setCategory(newCategory);
    // Reset sort to default if current sort is redundant or shuffled
    if (sort === 'shuffled' || (newCategory !== 'all' && sort === 'type')) {
      setSort('default');
    }
  }, [sort]);

  // Wrapper to reset sort if it becomes redundant when changing tier
  const handleTierChange = useCallback((newTier: number | null) => {
    setTier(newTier);
    // Reset sort to default if current sort is redundant or shuffled
    if (sort === 'shuffled' || (newTier !== null && sort === 'tier')) {
      setSort('default');
    }
  }, [sort]);

  // Fetch latest patch date
  useEffect(() => {
    async function fetchPatchDate() {
      try {
        const response = await fetch('https://api.deadlock-api.com/v1/patches');
        if (response.ok) {
          const patches = await response.json();
          if (Array.isArray(patches) && patches.length > 0) {
            const latestPatch = patches[0];
            if (latestPatch.title) {
              const dateMatch = latestPatch.title.match(/(\d{2}-\d{2}-\d{4})/);
              if (dateMatch) {
                const [month, day, year] = dateMatch[1].split('-');
                const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                const formatted = dateObj.toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric', 
                  year: 'numeric' 
                });
                setPatchDate(formatted);
              }
            }
          }
        }
      } catch {
        // Silently fail - patch date is optional
      }
    }
    fetchPatchDate();
  }, []);

  // Load items on mount
  useEffect(() => {
    async function loadItems() {
      try {
        setLoading(true);
        
        // Fetch directly from the API
        const response = await fetch(ITEMS_API_URL);
        
        if (!response.ok) {
          throw new Error(`API returned ${response.status}`);
        }
        
        const allItems = await response.json();
        
        // Filter to only purchasable shop items
        const shopItems = allItems.filter((item: any) => {
          // Must be shopable (purchasable in game)
          const isShopable = item.shopable === true;
          
          // Must not be disabled
          const isEnabled = !item.disabled;
          
          // Must have a shop image (the new art)
          const hasImage = !!item.shop_image || !!item.shop_image_webp;
          
          return isShopable && isEnabled && hasImage;
        });
        
        // First pass: Create a map of ALL items by ID for lookup (including non-shop items)
        // This is important because component_items may reference items not in our shopItems list
        const allItemsById = new Map<number, any>();
        const allItemsByClassName = new Map<string, any>();
        allItems.forEach((item: any) => {
          allItemsById.set(item.id, item);
          allItemsByClassName.set(item.class_name, item);
        });
        
        // Also create a map of just shop items for the upgradesTo reverse lookup
        const shopItemsById = new Map<number, any>();
        shopItems.forEach((item: any) => {
          shopItemsById.set(item.id, item);
        });
        
        // Process the shop items
        const processed = shopItems.map((item: any) => {
          const displayName = item.name || formatName(item.class_name);
          
          // Use shop_image fields which contain the new art
          const apiImage = item.shop_image_webp || item.shop_image || '';
          
          // Extract descriptions from tooltip_sections
          const { passiveDescription, activeDescription } = extractDescriptions(item as RawItem);
          const tooltipSections = item.tooltip_sections || [];
          
          // Determine if item has passive section based on tooltip_sections
          const hasInnateSection = tooltipSections.some((s: any) => 
            s.section_type === 'innate' || s.section_type === 'passive' || s.section_type === 'conditional'
          );
          const hasActiveSection = tooltipSections.some((s: any) => s.section_type === 'active');
          
          // Check if item is an imbue item using the imbue field from API
          const fullDescription = passiveDescription + ' ' + activeDescription;
          const isImbue = !!item.imbue || 
                          fullDescription.toLowerCase().includes('imbued') || 
                          fullDescription.toLowerCase().includes('imbue');
          
          // Check if item is active - use is_active_item field or activation type
          const activationType = (item.activation || '').toLowerCase();
          const isActive = item.is_active_item === true ||
                          activationType === 'instant_cast' || 
                          activationType === 'pressed' ||
                          activationType === 'press' ||
                          activationType === 'toggle' ||
                          activationType === 'channeled';
          
          // Extract component items (what this item is built FROM)
          // component_items is an array of class_names (strings), not IDs
          const componentItems: ComponentItem[] = [];
          if (item.component_items && Array.isArray(item.component_items)) {
            item.component_items.forEach((compClassName: string) => {
              const compItem = allItemsByClassName.get(compClassName);
              if (compItem) {
                componentItems.push({
                  id: compItem.id,
                  name: compItem.name || formatName(compItem.class_name)
                });
              } else {
                // Component not found in our data, still show the class_name formatted
                componentItems.push({
                  id: 0,
                  name: formatName(compClassName)
                });
              }
            });
          }
          
          // Extract cooldown for active items
          let cooldown: string | undefined;
          if (isActive && item.properties?.AbilityCooldown) {
            const cdValue = item.properties.AbilityCooldown.value;
            if (cdValue && cdValue !== '0' && cdValue !== 0) {
              cooldown = `${cdValue}s`;
            }
          }
          
          // Determine if there's a passive section to show
          // Show passive section if: has passive description, has innate tooltip section, 
          // or has passive-section stats AND is not purely an active-only item
          const itemUpgrades = item.upgrades || [];
          const allStats = extractStats(item.properties || {}, tooltipSections, itemUpgrades);
          const passiveStats = allStats.filter(s => s.section === 'passive');
          
          // Extract ordered content blocks for interleaved rendering
          const { activeBlocks, passiveBlocks } = extractContentBlocks(
            item.properties || {}, tooltipSections, itemUpgrades
          );
          
          // Extract cooldown for passive effects from the passive stats
          // Look for any stat with label "Cooldown" in the passive section
          let passiveCooldown: string | undefined;
          const passiveCooldownStat = passiveStats.find(s => s.label === 'Cooldown');
          if (passiveCooldownStat) {
            passiveCooldown = passiveCooldownStat.value;
          }
          const hasPassiveSection = hasInnateSection || 
                                    !!passiveDescription || 
                                    (passiveStats.length > 0 && (hasActiveSection || !!activeDescription));
          
          return {
            id: item.id,
            name: item.class_name,
            displayName: displayName,
            image: apiImage,
            fallbackImage: undefined,
            type: determineType(item),
            tier: item.item_tier || determineTier(item), // Use item_tier directly from API
            cost: item.cost || extractCost(item),
            stats: extractStats(item.properties || {}, tooltipSections, itemUpgrades),
            passiveDescription: passiveDescription || undefined,
            activeDescription: activeDescription || undefined,
            activeBlocks: activeBlocks.length > 0 ? activeBlocks : undefined,
            passiveBlocks: passiveBlocks.length > 0 ? passiveBlocks : undefined,
            hasPassiveSection: hasPassiveSection,
            isActive: isActive,
            isImbue: isImbue,
            cooldown: cooldown,
            passiveCooldown: passiveCooldown,
            componentItems: componentItems,
            upgradesTo: [] as ComponentItem[] // Will be computed in second pass
          };
        });
        
        // Second pass: Compute upgradesTo (reverse relationship)
        // For each item, find all items that have it in their component_items
        const processedById = new Map<number, ProcessedItem>();
        processed.forEach((item: ProcessedItem) => processedById.set(item.id, item));
        
        processed.forEach((item: ProcessedItem) => {
          item.componentItems.forEach((comp: ComponentItem) => {
            const componentItem = processedById.get(comp.id);
            if (componentItem) {
              componentItem.upgradesTo.push({
                id: item.id,
                name: item.displayName
              });
            }
          });
        });
        
        setItems(processed);
        setFilteredItems(processed);
      } catch (err) {
        console.error('Error loading items:', err);
        setError(`Failed to load items: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    }

    loadItems();
  }, []);

  // Filter and sort items when filters/sort change
  useEffect(() => {
    // Skip if shuffled - shuffle manages filteredItems directly
    if (sort === 'shuffled') return;

    let filtered = [...items];
    
    if (category !== 'all') {
      filtered = filtered.filter(item => item.type === category);
    }
    
    if (tier !== null) {
      filtered = filtered.filter(item => item.tier === tier);
    }
    
    // Apply sorting
    switch (sort) {
      case 'name':
        filtered.sort((a, b) => a.displayName.localeCompare(b.displayName));
        break;
      case 'type':
        // Order: weapon, vitality, spirit (then by name within type)
        const typeOrder: Record<string, number> = { weapon: 0, vitality: 1, spirit: 2 };
        filtered.sort((a, b) => {
          const typeCompare = (typeOrder[a.type] ?? 3) - (typeOrder[b.type] ?? 3);
          if (typeCompare !== 0) return typeCompare;
          return a.displayName.localeCompare(b.displayName);
        });
        break;
      case 'tier':
        // Sort by tier ascending, then by name within tier
        filtered.sort((a, b) => {
          const tierCompare = a.tier - b.tier;
          if (tierCompare !== 0) return tierCompare;
          return a.displayName.localeCompare(b.displayName);
        });
        break;
      // 'default' keeps original order from API
    }
    
    setFilteredItems(filtered);
    setCurrentIndex(0);
    setFlippedIndex(null);
  }, [items, category, tier, sort]);

  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setFlippedIndex(null); // Flip back before navigating
      setCurrentIndex(newIndex);
      // Play sound for new card (spatial audio handled in Carousel3D when XR is active)
      if (!xrActive && filteredItems[newIndex]) {
        playActiveSound(filteredItems[newIndex].type);
      }
    }
  }, [currentIndex, filteredItems, xrActive]);

  const goToNext = useCallback(() => {
    if (currentIndex < filteredItems.length - 1) {
      const newIndex = currentIndex + 1;
      setFlippedIndex(null); // Flip back before navigating
      setCurrentIndex(newIndex);
      // Play sound for new card (spatial audio handled in Carousel3D when XR is active)
      if (!xrActive && filteredItems[newIndex]) {
        playActiveSound(filteredItems[newIndex].type);
      }
    }
  }, [currentIndex, filteredItems, xrActive]);

  // Use refs to always have latest navigation functions for keyboard handler
  const goToPreviousRef = useRef(goToPrevious);
  const goToNextRef = useRef(goToNext);
  const currentIndexRef = useRef(currentIndex);
  const filteredItemsRef = useRef(filteredItems);
  
  // Keep refs updated
  useEffect(() => {
    goToPreviousRef.current = goToPrevious;
    goToNextRef.current = goToNext;
    currentIndexRef.current = currentIndex;
    filteredItemsRef.current = filteredItems;
  });

  // Keyboard navigation - using refs to avoid stale closures
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        goToPreviousRef.current();
      } else if (e.key === 'ArrowRight') {
        goToNextRef.current();
      } else if (e.key === ' ') {
        e.preventDefault();
        // Toggle flip for current card
        const idx = currentIndexRef.current;
        const items = filteredItemsRef.current;
        if (items[idx]) {
          playFlipSound(items[idx].type);
        }
        setFlippedIndex(prev => prev === idx ? null : idx);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // Empty deps - refs always have latest values

  const shuffle = useCallback(() => {
    const shuffled = [...filteredItems].sort(() => Math.random() - 0.5);
    setFilteredItems(shuffled);
    setCurrentIndex(0);
    setFlippedIndex(null);
    setSort('shuffled');
    // Play sound for first card (spatial audio handled in Carousel3D when XR is active)
    if (!xrActive && shuffled[0]) {
      playActiveSound(shuffled[0].type);
    }
  }, [filteredItems, xrActive]);

  const reset = useCallback(() => {
    setCurrentIndex(0);
    setFlippedIndex(null);
    // Play sound for first card (spatial audio handled in Carousel3D when XR is active)
    if (!xrActive && filteredItems[0]) {
      playActiveSound(filteredItems[0].type);
    }
  }, [filteredItems, xrActive]);

  const goToEnd = useCallback(() => {
    const lastIndex = filteredItems.length - 1;
    if (lastIndex >= 0) {
      setCurrentIndex(lastIndex);
      setFlippedIndex(null);
      // Play sound for last card (spatial audio handled in Carousel3D when XR is active)
      if (!xrActive && filteredItems[lastIndex]) {
        playActiveSound(filteredItems[lastIndex].type);
      }
    }
  }, [filteredItems, xrActive]);

  // Handle index change from carousel scroll
  const handleCarouselIndexChange = useCallback((newIndex: number) => {
    if (newIndex !== currentIndex) {
      setFlippedIndex(null); // Flip back when scrolling away
      setCurrentIndex(newIndex);
    }
  }, [currentIndex]);

  // Handle flip from carousel
  const handleCarouselFlip = useCallback((index: number) => {
    // If clicking a non-active card, just make it active (don't flip)
    if (index !== currentIndex) {
      setFlippedIndex(null); // Unflip current card
      setCurrentIndex(index); // Navigate to the clicked card (CardCarousel handles sound)
    } else {
      // Toggle flip on the active card (Flashcard component handles the sound)
      setFlippedIndex(prev => prev === index ? null : index);
    }
  }, [currentIndex]);

  if (loading) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center"
        style={{ 
          minHeight: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          backgroundColor: '#0d0d14',
          color: 'white'
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div 
            style={{
              width: '64px',
              height: '64px',
              border: '4px solid #3b82f6',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px'
            }}
          />
          <p style={{ fontSize: '1.25rem', color: 'white' }}>Loading Deadlock items...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div 
        className="min-h-screen flex items-center justify-center"
        style={{ 
          minHeight: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          backgroundColor: '#0d0d14',
          color: 'white'
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: '1.25rem', color: '#f87171', marginBottom: '16px' }}>{error}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 24px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show intro screen until user starts
  if (!hasStarted) {
    return <IntroScreen onStart={() => setHasStarted(true)} />;
  }

  return (
    <>
      {/* XR Canvas — always mounted so WebXR manager is ready, but content only
          renders when XR is active to avoid loading textures in 2D mode */}
      <XRScene
        active={xrActive}
        items={filteredItems}
        totalItemCount={items.length}
        currentIndex={currentIndex}
        flippedIndex={flippedIndex}
        category={category}
        tier={tier}
        sort={sort}
        patchDate={patchDate}
        onFlip={handleCarouselFlip}
        onIndexChange={handleCarouselIndexChange}
        onPrevious={goToPrevious}
        onNext={goToNext}
        onShuffle={shuffle}
        onReset={reset}
        onGoToEnd={goToEnd}
        onCategoryChange={handleCategoryChange}
        onTierChange={handleTierChange}
        onSortChange={setSort}
      />

      {/* XR Entry Button - only shows on supported devices */}
      <XRButton onEnterXR={() => setXrActive(true)} category={category} />

      {/* 2D UI — hidden (not unmounted) when XR is active so it's ready when returning */}
      <div style={{ display: xrActive ? 'none' : 'contents' }}>
      {/* Landscape warning overlay */}
      <div className="landscape-warning">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        <p style={{ fontSize: '18px', fontWeight: 600, color: '#5eead4' }}>
          Please rotate your device
        </p>
        <p style={{ fontSize: '14px', color: 'rgba(255,255,255,0.6)' }}>
          This app works best in portrait mode
        </p>
      </div>

      {/* Main content */}
      <div 
        className="main-content"
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '10px 0 12px', // Vertical padding only - carousel needs full width
          overflow: 'hidden',
          gap: '4px',
        }}
      >
      {/* Header - compact on mobile */}
      <header style={{ 
        textAlign: 'center', 
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '2px',
      }}>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: '6px',
        }}>
          <img 
            src={`${import.meta.env.BASE_URL}images/logo_deadlock_mark_only_png.png`}
            alt="Deadlock Logo" 
            style={{ 
              height: 'clamp(22px, 6vw, 34px)', 
              width: 'auto',
              filter: 'brightness(0.94) sepia(0.15)',
            }}
          />
          <img 
            src={`${import.meta.env.BASE_URL}images/logo_deadlock_word_only_png.png`}
            alt="Deadlock" 
            style={{ 
              height: 'clamp(16px, 4vw, 24px)', 
              width: 'auto',
              filter: 'brightness(0.94) sepia(0.15)',
            }}
          />
        </div>
        <p style={{ 
          color: '#fae9d0', 
          fontSize: 'clamp(0.75rem, 3vw, 1rem)', 
          margin: 0,
          fontWeight: 700,
          letterSpacing: '0.02em',
          fontFamily: 'Georgia, "Times New Roman", serif',
        }}>
          Item Trainer
        </p>
        <p style={{ color: '#2dd4bf', fontSize: '9px', margin: 0, opacity: 0.6 }}>
          {items.length} items{patchDate && ` • Patch ${patchDate}`}
        </p>
      </header>

      {/* Filters - compact */}
      <div style={{ flexShrink: 0, padding: '0 6px' }}>
        <FilterBar
          category={category}
          onCategoryChange={handleCategoryChange}
          tier={tier}
          onTierChange={handleTierChange}
          sort={sort}
          onSortChange={setSort}
        />
      </div>

      {/* Main content - fills remaining space */}
      <main 
        style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          justifyContent: 'flex-start',
          minHeight: 0,
          overflow: 'hidden',
          paddingTop: '4px',
        }}
      >
        {filteredItems.length > 0 ? (
          <>
            <div 
              style={{ 
                flex: 1, 
                display: 'flex', 
                justifyContent: 'center', 
                alignItems: 'center',
                minHeight: 0,
                width: '100%',
                overflow: 'hidden',
              }}
            >
              <CardCarousel
                ref={carouselRef}
                items={filteredItems}
                currentIndex={currentIndex}
                onIndexChange={handleCarouselIndexChange}
                flippedIndex={flippedIndex}
                onFlip={handleCarouselFlip}
              />
            </div>
            
            <div style={{ flexShrink: 0, marginTop: '8px', width: '100%', padding: '0 12px' }}>
              <Navigation
                currentIndex={currentIndex}
                total={filteredItems.length}
                currentType={filteredItems[currentIndex]?.type as 'weapon' | 'vitality' | 'spirit'}
                categoryFilter={category}
                onPrevious={goToPrevious}
                onNext={goToNext}
                onShuffle={shuffle}
                onReset={reset}
                onGoToEnd={goToEnd}
                onSeek={(index) => {
                  setFlippedIndex(null);
                  setCurrentIndex(index);
                  // Directly scroll the carousel (instant for slider responsiveness)
                  carouselRef.current?.scrollToIndex(index, true);
                  // Play sound for new card
                  if (filteredItems[index]) {
                    playActiveSound(filteredItems[index].type);
                  }
                }}
              />
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px' }}>
            <p style={{ color: '#9ca3af', fontSize: '1rem' }}>
              No items found
            </p>
            <button
              onClick={() => {
                setCategory('all');
                setTier(null);
              }}
              style={{
                marginTop: '12px',
                padding: '10px 20px',
                backgroundColor: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              Clear Filters
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer 
        style={{ 
          textAlign: 'center', 
          color: '#4b5563', 
          fontSize: '10px',
          flexShrink: 0,
          marginTop: '4px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: '4px',
        }}>
          <span style={{ color: '#6b7280' }}>Made by</span>
          <a
            href="https://linktr.ee/delicioussalad"
            target="_blank"
            rel="noopener noreferrer"
            style={{ 
              color: '#32A90D', 
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <img 
              src={`${import.meta.env.BASE_URL}images/salad_logo_small.png`}
              alt="Salad Logo" 
              style={{ height: '14px', width: 'auto' }}
            />
            DeliciousSalad
          </a>
        </div>
        <p style={{ margin: 0 }}>
          Data from{' '}
          <a
            href="https://deadlock-api.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#5eead4' }}
          >
            Deadlock API
          </a>
          {' '}• Not affiliated with Valve Corporation
        </p>
      </footer>
    </div>
    </div>

    {/* Music player toggle - starts playing automatically */}
    <MusicPlayer autoPlay={true} categoryFilter={category} />
    </>
  );
}

export default App;
