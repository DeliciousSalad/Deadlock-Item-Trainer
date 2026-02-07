import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import type { ProcessedItem, ContentBlock, StatInfo } from '../types';
import { TYPE_COLORS } from '../constants';
import { hapticFlip } from '../utils/haptics';
import { playHoverSound, playFlipSound } from '../utils/sounds';

// Base card dimensions - will scale responsively
const BASE_CARD_WIDTH = 280;
const BASE_CARD_HEIGHT = 380;
const CARD_ASPECT_RATIO = BASE_CARD_HEIGHT / BASE_CARD_WIDTH;

interface FlashcardProps {
  item: ProcessedItem;
  showAnswer?: boolean;
  onFlip?: () => void;
  isImageLoaded?: boolean;
  isActive?: boolean;
}

// Convert tier number to Roman numeral
function toRoman(num: number): string {
  const romanNumerals: Record<number, string> = {
    1: 'I',
    2: 'II',
    3: 'III',
    4: 'IV',
    5: 'V',
  };
  return romanNumerals[num] || num.toString();
}

// Determine if a stat value is negative (debuff) and return appropriate color
function getStatValueColor(value: string): string {
  // Check if the value represents a negative/debuff stat
  // This includes values starting with "-" or containing "-" after formatting
  const isNegative = value.startsWith('-') || value.startsWith('+-');
  return isNegative ? '#ff6b6b' : '#69db7c'; // red for negative, green for positive
}

// Render a stats grid block (shared between flat and interleaved layouts)
function renderStatsGrid(stats: StatInfo[], keyPrefix: string) {
  const filteredStats = stats.filter(s => s.label !== 'Cooldown');
  if (filteredStats.length === 0) return null;
  
  return (
    <div style={{ 
      padding: '8px',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '6px',
    }}>
      {filteredStats.map((stat, index) => (
        <div
          key={`${keyPrefix}-${index}`}
          style={{
            backgroundColor: 'rgba(0,0,0,0.3)',
            padding: '8px 10px',
            borderRadius: '4px',
          }}
        >
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '4px',
            marginBottom: '2px',
          }}>
            <span 
              style={{ 
                fontWeight: 'bold', 
                color: getStatValueColor(stat.value),
                fontSize: '14px',
              }}
            >
              {stat.value}
            </span>
            {stat.scalesWith && (
              <span 
                style={{ 
                  fontSize: '9px', 
                  color: stat.scalesWith === 'Spirit' ? '#9C6FDF' : 
                         stat.scalesWith === 'Weapon' ? '#D4A84B' : '#69db7c',
                  fontWeight: 'bold',
                  backgroundColor: 'rgba(0,0,0,0.4)',
                  padding: '1px 4px',
                  borderRadius: '3px',
                }}
                title={stat.scaleMultiplier 
                  ? `Scales ${stat.scaleMultiplier}x with ${stat.scalesWith}` 
                  : `Scales with ${stat.scalesWith}`}
              >
                {stat.scaleMultiplier ? `x${stat.scaleMultiplier}` : `↑${stat.scalesWith.charAt(0)}`}
              </span>
            )}
          </div>
          <div style={{ 
            color: 'rgba(255,255,255,0.6)', 
            fontSize: '10px',
            fontWeight: stat.hasBuiltInCondition ? 'bold' : 'normal'
          }}>
            {stat.label}
            {stat.isConditional && (
              <span style={{ color: '#ffa500', fontStyle: 'italic' }}> (cond)</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Render a description block
function renderDescriptionBlock(text: string, bgColor: string = 'rgba(0,0,0,0.2)') {
  return (
    <div style={{ padding: '10px 12px', backgroundColor: bgColor }}>
      <p style={{ 
        color: 'rgba(255,255,255,0.85)', 
        fontSize: '12px', 
        margin: 0,
        lineHeight: 1.5,
      }}>
        {parseDescription(text)}
      </p>
    </div>
  );
}

// Render interleaved content blocks (descriptions and stat grids in order)
function renderContentBlocks(blocks: ContentBlock[], keyPrefix: string, descBgColor: string = 'rgba(0,0,0,0.2)') {
  return blocks.map((block, index) => {
    if (block.type === 'description') {
      return <div key={`${keyPrefix}-desc-${index}`}>{renderDescriptionBlock(block.text, descBgColor)}</div>;
    } else {
      return <div key={`${keyPrefix}-stats-${index}`}>{renderStatsGrid(block.stats, `${keyPrefix}-${index}`)}</div>;
    }
  });
}

// Decode HTML entities
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = text;
  return textarea.value;
}

// Parse description HTML and render with highlights
function parseDescription(description: string): React.ReactNode {
  // First, decode any HTML entities (API sometimes returns encoded HTML)
  let cleaned = decodeHtmlEntities(description);
  
  // Remove SVG tags entirely (they're icons that don't render well in text)
  cleaned = cleaned.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '');
  
  // Replace binding placeholders like {g:citadel_binding:'Reload'} with styled versions
  // We'll use a special marker that we can parse later
  cleaned = cleaned.replace(/\{g:citadel_binding:'([^']+)'\}/gi, '<keybind>$1</keybind>');
  
  // Handle nested spans inside highlight spans - extract inner content before the outer span is processed
  // Pattern: <span class="highlight">...<span class="inline-attribute-label...">text</span></span>
  // We need to process these specially because the non-greedy regex gets confused
  cleaned = cleaned.replace(
    /<span[^>]*class="highlight"[^>]*>(<img[^>]*\/>)(<span[^>]*class="inline-attribute-label[^"]*"[^>]*>([^<]*)<\/span>)<\/span>/gi,
    (match, img, innerSpan, innerText) => {
      // Replace the nested structure with the img followed by the styled text
      return `${img}<span class="inline-attribute-label">${innerText}</span>`;
    }
  );
  
  // Normalize whitespace in span tags (handles newlines inside spans)
  cleaned = cleaned.replace(/(<span[^>]*>)\s+/g, '$1');
  cleaned = cleaned.replace(/\s+(<\/span>)/g, '$1');
  
  // Split by various patterns: span tags, br tags, keybind markers, and img tags
  const tagPattern = /(<span[^>]*>[\s\S]*?<\/span>|<br\s*\/?>|<keybind>[^<]+<\/keybind>|<img[^>]*\/>|<img[^>]*>)/gi;
  const parts = cleaned.split(tagPattern);
  
  return parts.map((part, index) => {
    // Check for br tags
    if (/<br\s*\/?>/i.test(part)) {
      return <br key={index} />;
    }
    
    // Check for img tags (inline icons from the API)
    const imgMatch = part.match(/<img[^>]*src="([^"]+)"[^>]*(?:alt="([^"]*)")?[^>]*\/?>/i);
    if (imgMatch) {
      const src = imgMatch[1];
      const alt = imgMatch[2] || '';
      return (
        <img 
          key={index}
          src={src}
          alt={alt}
          style={{
            height: '14px',
            width: 'auto',
            display: 'inline-block',
            verticalAlign: 'middle',
            marginRight: '2px',
          }}
        />
      );
    }
    
    // Check for keybind markers
    const keybindMatch = part.match(/<keybind>([^<]+)<\/keybind>/i);
    if (keybindMatch) {
      return (
        <strong key={index}>[{keybindMatch[1]}]</strong>
      );
    }
    
    // Helper function to parse inner content recursively
    const parseInnerContent = (content: string): React.ReactNode => {
      // Check if content contains HTML tags that need parsing
      if (/<(img|span|br)/i.test(content)) {
        return parseDescription(content);
      }
      return content.trim();
    };
    
    // Check for highlight spans
    const highlightMatch = part.match(/<span[^>]*class="highlight"[^>]*>([\s\S]*?)<\/span>/i);
    if (highlightMatch) {
      return (
        <span 
          key={index} 
          style={{ 
            color: '#ffd700', 
            fontWeight: 'bold',
          }}
        >
          {parseInnerContent(highlightMatch[1])}
        </span>
      );
    }
    
    // Check for diminish spans (de-emphasized text, like secondary info)
    const diminishMatch = part.match(/<span[^>]*class="diminish"[^>]*>([\s\S]*?)<\/span>/i);
    if (diminishMatch) {
      return (
        <span 
          key={index} 
          style={{ 
            color: 'rgba(255,255,255,0.6)', 
            fontStyle: 'italic',
          }}
        >
          {parseInnerContent(diminishMatch[1])}
        </span>
      );
    }
    
    // Check for inline-attribute-label spans (like BonusWeaponDamage)
    const attrMatch = part.match(/<span[^>]*class="inline-attribute-label[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (attrMatch) {
      return (
        <span 
          key={index} 
          style={{ 
            color: '#69db7c', 
            fontWeight: 'bold',
          }}
        >
          {parseInnerContent(attrMatch[1])}
        </span>
      );
    }
    
    // Check for any other span with a class (generic handling)
    const genericSpanMatch = part.match(/<span[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/span>/i);
    if (genericSpanMatch) {
      return (
        <span 
          key={index} 
          style={{ 
            color: '#ffd700', 
            fontWeight: 'bold',
          }}
        >
          {parseInnerContent(genericSpanMatch[2])}
        </span>
      );
    }
    
    // Check for spans without class attribute (style-only spans like gold highlights)
    const noClassSpanMatch = part.match(/<span[^>]*>([\s\S]*?)<\/span>/i);
    if (noClassSpanMatch) {
      return (
        <span 
          key={index} 
          style={{ 
            color: '#ffd700', 
            fontWeight: 'bold',
          }}
        >
          {parseInnerContent(noClassSpanMatch[1])}
        </span>
      );
    }
    
    // Handle unclosed inline-attribute-label spans (malformed HTML from API)
    // These come as: <span class="inline-attribute-label...">text (no closing tag)
    const unclosedAttrLabel = part.match(/<span[^>]*class="inline-attribute-label[^"]*"[^>]*>([^<]*)/i);
    if (unclosedAttrLabel) {
      return (
        <span 
          key={index} 
          style={{ 
            color: '#69db7c', 
            fontWeight: 'bold',
          }}
        >
          {unclosedAttrLabel[1].trim()}
        </span>
      );
    }
    
    // Clean up any stray HTML tags that weren't captured by the split pattern
    const cleanedPart = part
      .replace(/<\/span>/gi, '')
      .replace(/<span[^>]*>/gi, '')
      .replace(/<[^>]*>/gi, ''); // Remove any other stray tags
    
    return cleanedPart;
  });
}

export function Flashcard({ item, showAnswer: externalShowAnswer, onFlip, isImageLoaded = true, isActive = true }: FlashcardProps) {
  const [internalFlipped, setInternalFlipped] = useState(false);
  const prevItemIdRef = useRef(item.id);
  const shouldAnimateRef = useRef(false); // Start with no animation
  const [, forceUpdate] = useState(0); // Used to trigger re-render
  
  const isFlipped = externalShowAnswer !== undefined ? externalShowAnswer : internalFlipped;

  // When item changes, instantly reset to front without animation
  useLayoutEffect(() => {
    if (item.id !== prevItemIdRef.current) {
      // Disable animation for this transition
      shouldAnimateRef.current = false;
      // Reset internal flip state
      setInternalFlipped(false);
      // Update tracked item id
      prevItemIdRef.current = item.id;
      // Force a synchronous re-render to apply no-animation class
      forceUpdate(n => n + 1);
    }
  }, [item.id]);

  // Re-enable animation after the card has rendered in its new state
  useEffect(() => {
    if (!shouldAnimateRef.current) {
      // Use a small timeout to ensure the DOM has updated without animation
      const timer = setTimeout(() => {
        shouldAnimateRef.current = true;
        forceUpdate(n => n + 1);
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [item.id]);

  const handleClick = () => {
    hapticFlip();
    // Only play flip sound if this is the active card (actually flipping, not switching)
    if (isActive) {
      playFlipSound(item.type);
    }
    if (onFlip) {
      onFlip();
    } else {
      setInternalFlipped(!internalFlipped);
    }
  };

  const colors = TYPE_COLORS[item.type] || TYPE_COLORS.weapon;

  return (
    <div
      style={{ 
        // Outer wrapper fills parent, centers the card
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <div
        className={`flip-card ${isFlipped ? 'flipped' : ''} ${!shouldAnimateRef.current ? 'no-animation' : ''}`}
        style={{ 
          // Card maintains aspect ratio within available space
          width: '100%',
          aspectRatio: `${BASE_CARD_WIDTH} / ${BASE_CARD_HEIGHT}`,
          maxHeight: '100%',
          // Disable double-tap-zoom delay so click/tap fires immediately on touch
          touchAction: 'manipulation',
          // When height is the constraint, width adjusts via aspect-ratio
          // object-fit doesn't work on divs, but aspect-ratio handles this
        }}
        onPointerEnter={() => playHoverSound(item.type)}
      >
        <div className="flip-card-inner">
        {/* Front of card - click to flip */}
        <div 
          className="flip-card-front cursor-pointer" 
          onClick={handleClick}
          style={{ 
            borderRadius: '6px', 
            overflow: 'hidden', 
            border: `2px solid ${colors.border}`,
            boxShadow: `0 4px 16px rgba(0,0,0,0.5)`,
            background: colors.bg,
          }}
        >
          {/* Tier Badge - Top Right Corner */}
          <div 
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              width: '48px',
              height: '48px',
              background: colors.border,
              clipPath: 'polygon(100% 0, 0 0, 100% 100%)',
              zIndex: 10,
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'flex-end',
            }}
          >
            <span 
              style={{
                color: '#000',
                fontWeight: 'bold',
                fontSize: '16px',
                marginRight: '6px',
                marginTop: '4px',
                fontFamily: 'serif',
                textShadow: '0 0 2px rgba(255,255,255,0.3)',
              }}
            >
              {toRoman(item.tier)}
            </span>
          </div>

          {/* Imbue Tag - Banner across bottom of image */}
          {item.isImbue && (
            <div 
              style={{
                position: 'absolute',
                bottom: '70px',
                left: 0,
                right: 0,
                background: 'linear-gradient(180deg, #9C6FDF 0%, #7B4FC9 100%)',
                color: '#fff',
                padding: '6px 0',
                fontSize: '13px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '2px',
                textAlign: 'center',
                boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                zIndex: 15,
              }}
            >
              IMBUE
            </div>
          )}

          {/* Active Tag - Between image and name */}
          {item.isActive && !item.isImbue && (
            <div 
              style={{
                position: 'absolute',
                bottom: '70px',
                left: '50%',
                transform: 'translateX(-50%) translateY(50%)',
                background: '#000',
                color: '#fff',
                padding: '4px 16px',
                borderRadius: '3px',
                fontSize: '12px',
                fontWeight: 'bold',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.4)',
                zIndex: 15,
              }}
            >
              ACTIVE
            </div>
          )}

          {/* Icon Container - Full Width, Top Aligned */}
          <div 
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: '70px',
              zIndex: 5,
            }}
          >
            {/* Item Icon */}
            <div 
              style={{
                width: '100%',
                height: '100%',
                backgroundImage: isImageLoaded ? `url("${item.image}")` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'top center',
                backgroundRepeat: 'no-repeat',
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: isImageLoaded ? 'transparent' : 'rgba(0,0,0,0.3)',
              }}
              role="img"
              aria-label={item.displayName}
            >
              {!isImageLoaded && (
                <div style={{
                  width: '40px',
                  height: '40px',
                  border: '3px solid rgba(255,255,255,0.2)',
                  borderTopColor: colors.border,
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                }} />
              )}
            </div>
          </div>

          {/* Item Name Label - Bottom */}
          <div 
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '70px',
              background: colors.bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 10,
            }}
          >
            <div 
              style={{
                color: '#fff',
                fontSize: '16px',
                fontWeight: 'bold',
                textAlign: 'center',
                lineHeight: 1.3,
                fontFamily: 'system-ui, sans-serif',
                padding: '0 12px',
              }}
            >
              {item.displayName}
            </div>
          </div>
        </div>

        {/* Back of card - Stats - click to flip */}
        <div 
          className="flip-card-back" 
          onClick={handleClick}
          style={{ 
            borderRadius: '6px', 
            border: `2px solid ${colors.border}`,
            boxShadow: `0 4px 16px rgba(0,0,0,0.5)`,
            display: 'flex',
            flexDirection: 'column',
            background: colors.bg,
            cursor: 'pointer',
          }}
        >
          {/* Header */}
          <div 
            style={{ 
              background: 'rgba(0,0,0,0.5)',
              padding: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              borderBottom: `1px solid ${colors.border}`,
              position: 'relative',
              zIndex: 5,
              flexShrink: 0, // Don't shrink the header
            }}
          >
            <div
              style={{ 
                width: '44px', 
                height: '44px', 
                backgroundImage: `url("${item.image}")`,
                backgroundSize: 'contain',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                flexShrink: 0,
              }}
              role="img"
              aria-label={item.displayName}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div 
                style={{ 
                  color: '#fff', 
                  fontSize: '14px', 
                  fontWeight: 'bold',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {item.displayName}
              </div>
              <div 
                style={{ 
                  color: 'rgba(255,255,255,0.6)', 
                  fontSize: '12px',
                  display: 'flex',
                  gap: '6px',
                }}
              >
                <span>{item.tier === 5 ? 'Legendary' : item.cost}</span>
                <span>•</span>
                <span>Tier {item.tier}</span>
              </div>
            </div>
          </div>

          {/* Scrollable content area */}
          <div 
            style={{ 
              flex: 1, 
              overflowY: 'auto', 
              overflowX: 'hidden',
              position: 'relative',
              zIndex: 5,
              minHeight: 0, // Critical for flex overflow
            }}
          >
            {/* 1. INNATE stats - general bonuses shown at the very top */}
            {item.stats.filter(s => s.section === 'innate').length > 0 && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                {item.stats.filter(s => s.section === 'innate').map((stat, index) => (
                  <div
                    key={`innate-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      marginBottom: index < item.stats.filter(s => s.section === 'innate').length - 1 ? '4px' : 0,
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: getStatValueColor(stat.value), fontWeight: 'bold' }}>
                      {stat.value}
                    </span>
                    <span style={{ 
                      color: 'rgba(255,255,255,0.9)',
                      fontWeight: stat.hasBuiltInCondition ? 'bold' : 'normal'
                    }}>
                      {stat.label}
                      {stat.isConditional && (
                        <span 
                          style={{ 
                            marginLeft: '4px',
                            fontSize: '9px',
                            color: '#ffa500',
                            fontStyle: 'italic',
                          }}
                          title="Conditional - only applies under certain conditions"
                        >
                          (conditional)
                        </span>
                      )}
                    </span>
                    {stat.scalesWith && (
                      <span 
                        style={{ 
                          fontSize: '10px', 
                          color: stat.scalesWith === 'Spirit' ? '#9C6FDF' : 
                                 stat.scalesWith === 'Weapon' ? '#D4A84B' : '#69db7c',
                          fontWeight: 'bold',
                        }}
                        title={stat.scaleMultiplier 
                          ? `Scales ${stat.scaleMultiplier}x with ${stat.scalesWith}` 
                          : `Scales with ${stat.scalesWith}`}
                      >
                        {stat.scaleMultiplier ? `x${stat.scaleMultiplier}` : `↑${stat.scalesWith.charAt(0)}`}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 2. PASSIVE Section - show only if there's actual content (description or stats, excluding Cooldown which goes in header) */}
            {(item.stats.filter(s => s.section === 'passive' && s.label !== 'Cooldown').length > 0 || 
              item.passiveDescription) && (
              <>
                {/* Passive header */}
                <div 
                  style={{ 
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    padding: '6px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <span style={{ 
                    color: '#fff', 
                    fontWeight: 'bold', 
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                  }}>
                    Passive
                  </span>
                  {item.passiveCooldown && (
                    <span style={{ 
                      color: 'rgba(255,255,255,0.7)', 
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}>
                      <span style={{ fontSize: '12px' }}>⏱</span>
                      {item.passiveCooldown}
                    </span>
                  )}
                </div>
                
                {/* Passive content - use interleaved blocks if available, otherwise flat layout */}
                {item.passiveBlocks ? (
                  renderContentBlocks(item.passiveBlocks, 'passive-block', 'rgba(0,0,0,0.2)')
                ) : (
                  <>
                    {item.passiveDescription && renderDescriptionBlock(item.passiveDescription)}
                    {renderStatsGrid(
                      item.stats.filter(s => s.section === 'passive' && s.label !== 'Cooldown'),
                      'passive'
                    )}
                  </>
                )}
              </>
            )}

            {/* 3. ACTIVE Section - show if item is active OR has active-section stats */}
            {(item.isActive || item.stats.filter(s => s.section === 'active').length > 0 || item.activeDescription) && (
              <>
                {/* Active header bar */}
                <div 
                  style={{ 
                    backgroundColor: 'rgba(0,0,0,0.5)',
                    padding: '6px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  <span style={{ 
                    color: '#fff', 
                    fontWeight: 'bold', 
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                  }}>
                    Active
                  </span>
                  {item.cooldown && (
                    <span style={{ 
                      color: 'rgba(255,255,255,0.7)', 
                      fontSize: '11px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}>
                      <span style={{ fontSize: '12px' }}>⏱</span>
                      {item.cooldown}
                    </span>
                  )}
                </div>

                {/* Active content - use interleaved blocks if available, otherwise flat layout */}
                {item.activeBlocks ? (
                  renderContentBlocks(item.activeBlocks, 'active-block', 'rgba(156, 111, 223, 0.1)')
                ) : (
                  <>
                    {(item.activeDescription || (item.passiveDescription && !item.hasPassiveSection)) && 
                      renderDescriptionBlock(
                        item.activeDescription || item.passiveDescription || '',
                        'rgba(156, 111, 223, 0.1)'
                      )
                    }
                    {renderStatsGrid(
                      item.stats.filter(s => s.section === 'active' && s.label !== 'Cooldown'),
                      'active'
                    )}
                  </>
                )}
              </>
            )}

            {/* No content message */}
            {item.stats.length === 0 && !item.passiveDescription && !item.activeDescription && (
              <div 
                style={{ 
                  textAlign: 'center', 
                  color: 'rgba(255,255,255,0.4)', 
                  padding: '24px 12px',
                  fontSize: '14px',
                }}
              >
                No stats available
              </div>
            )}
          </div>

          {/* Upgrade Relationships - anchored to bottom */}
          {(item.componentItems.length > 0 || item.upgradesTo.length > 0) && (
            <div 
              style={{ 
                padding: '8px 10px', 
                borderTop: `1px solid rgba(255,255,255,0.1)`,
                backgroundColor: 'rgba(0,0,0,0.2)',
                fontSize: '11px',
                flexShrink: 0,
                position: 'relative',
                zIndex: 5,
              }}
            >
              {/* Upgrades From (Component Items) */}
              {item.componentItems.length > 0 && (
                <div style={{ marginBottom: item.upgradesTo.length > 0 ? '6px' : 0 }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', marginRight: '6px' }}>
                    Upgrades from:
                  </span>
                  <span style={{ color: '#ffd700' }}>
                    {item.componentItems.map(c => c.name).join(', ')}
                  </span>
                </div>
              )}
              
              {/* Upgrades To */}
              {item.upgradesTo.length > 0 && (
                <div>
                  <span style={{ color: 'rgba(255,255,255,0.5)', marginRight: '6px' }}>
                    Upgrades to:
                  </span>
                  <span style={{ color: '#69db7c' }}>
                    {item.upgradesTo.map(u => u.name).join(', ')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
