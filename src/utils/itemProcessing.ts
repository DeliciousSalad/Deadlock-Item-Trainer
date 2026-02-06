// Item processing utilities for the Deadlock Flashcards app

import type { StatSection, StatInfo, RawItem, RawItemProperty, ContentBlock } from '../types';
import { SCALE_TYPE_MAP } from '../constants';

/**
 * Format a class_name into a display name
 * e.g., "upgrade_headshot_booster" -> "Headshot Booster"
 */
export function formatName(className: string): string {
  return className
    .replace(/^upgrade_/, '')
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Determine item type from API data
 */
export function determineType(item: RawItem): string {
  const itemSlotType = (item.item_slot_type || '').toLowerCase();
  
  if (itemSlotType.includes('weapon')) return 'weapon';
  if (itemSlotType.includes('armor') || itemSlotType.includes('vitality')) return 'vitality';
  if (itemSlotType.includes('tech') || itemSlotType.includes('spirit')) return 'spirit';
  
  return 'weapon';
}

/**
 * Extract cost from item data
 */
export function extractCost(item: RawItem): number {
  const cost = item.cost || 
               item.properties?.AbilityResourceCost?.value ||
               item.properties?.m_nAbilityPointsCost?.value ||
               item.properties?.Cost?.value ||
               0;
  return Number(cost) || 0;
}

/**
 * Determine item tier from API data
 */
export function determineTier(item: RawItem): number {
  if (item.item_tier) return item.item_tier;
  
  const className = (item.class_name || '').toLowerCase();
  if (className.includes('t5_') || className.includes('tier5')) return 5;
  if (className.includes('t4_') || className.includes('tier4')) return 4;
  if (className.includes('t3_') || className.includes('tier3')) return 3;
  if (className.includes('t2_') || className.includes('tier2')) return 2;
  if (className.includes('t1_') || className.includes('tier1')) return 1;
  
  // Fallback based on cost
  const cost = extractCost(item);
  if (cost >= 10000) return 5;
  if (cost >= 6000) return 4;
  if (cost >= 3000) return 3;
  if (cost >= 1250) return 2;
  return 1;
}

/**
 * Get friendly name for a scale type
 */
export function getScaleStatName(scaleType: string): string | undefined {
  return SCALE_TYPE_MAP[scaleType];
}

/**
 * Extract a single stat from a property
 */
export function extractStat(
  propName: string, 
  prop: RawItemProperty | undefined, 
  sectionType: StatSection, 
  upgradesMap: Map<string, string>, 
  isConditional: boolean = false,
  isImportant: boolean = false
): StatInfo | null {
  if (!prop || typeof prop !== 'object') return null;
  
  // Get value - use bonus value ONLY if base value is 0 or empty
  let value = prop.value;
  const bonusValue = upgradesMap.get(propName);
  
  if ((value === undefined || value === null || value === '0' || value === 0 || value === '') && bonusValue) {
    value = bonusValue;
  }
  
  if (value === undefined || value === null || value === '0' || value === 0 || value === '') return null;
  if (!prop.label) return null;
  
  let displayValue = String(value);
  
  // Handle prefix - {s:sign} should only be + for positive values
  if (prop.prefix) {
    const isNegative = displayValue.startsWith('-');
    const signReplacement = isNegative ? '' : '+';
    displayValue = prop.prefix.replace('{s:sign}', signReplacement) + displayValue;
  }
  
  // Only append postfix if value doesn't already contain a unit
  if (prop.postfix) {
    const trimmedPostfix = prop.postfix.trim();
    const trimmedValue = displayValue.trim();
    
    // Check if value already ends with the postfix
    if (trimmedValue.endsWith(trimmedPostfix)) {
      // Already has the exact postfix, don't append
    } else {
      // Check if value ends with the base unit of the postfix (e.g., "m" from "m/s")
      // This handles cases like value="2.5m" postfix="m/s" -> should become "2.5 m/s" not "2.5m m/s"
      const baseUnit = trimmedPostfix.split('/')[0].trim(); // Get "m" from "m/s"
      if (baseUnit && trimmedValue.endsWith(baseUnit)) {
        // Value has the base unit, replace it with the full postfix
        displayValue = trimmedValue.slice(0, -baseUnit.length).trim() + ' ' + trimmedPostfix;
      } else {
        displayValue += prop.postfix;
      }
    }
  }
  
  // Extract scaling information - only if there's an explicit multiplier
  let scalesWith: string | undefined;
  let scaleMultiplier: number | undefined;
  
  if (prop.scale_function) {
    const sf = prop.scale_function;
    const multiplierValue = sf.stat_scale ?? sf.scale_value ?? sf.bonus_scale;
    
    if (multiplierValue !== undefined && typeof multiplierValue === 'number' && multiplierValue > 0) {
      scaleMultiplier = multiplierValue;
      
      if (sf.specific_stat_scale_type) {
        scalesWith = getScaleStatName(sf.specific_stat_scale_type);
      } else if (sf.scaling_stats && Array.isArray(sf.scaling_stats)) {
        for (const stat of sf.scaling_stats) {
          const name = getScaleStatName(stat);
          if (name) {
            scalesWith = name;
            break;
          }
        }
      }
    }
  }
  
  // Check if property is conditionally applied
  // Show "(cond)" marker when:
  // 1. The section_type is explicitly 'conditional', OR
  // 2. The property has 'ConditionallyApplied' flag AND no 'conditional' field AND
  //    it's an important_property with 'slow' css_class (enemy debuff), OR
  //    it's in a passive section
  const hasConditionalFlag = Array.isArray(prop.usage_flags) && 
    prop.usage_flags.includes('ConditionallyApplied');
  const conditionAlreadyInLabel = !!prop.conditional;
  
  // Only important_properties with 'slow' css_class are shown as conditional in active sections
  // (regular properties with slow like Dash Distance are not marked conditional in-game)
  const isImportantEnemyDebuff = isImportant && prop.css_class === 'slow';
  const isPassiveSection = sectionType === 'passive';
  
  // Show conditional marker if:
  // - Section is 'conditional', OR
  // - Has ConditionallyApplied flag, no built-in condition, AND (is important enemy debuff OR is passive section)
  const shouldMarkConditional = isConditional || 
    (hasConditionalFlag && !conditionAlreadyInLabel && (isImportantEnemyDebuff || isPassiveSection));
  
  return { 
    label: prop.label, 
    value: displayValue, 
    icon: prop.icon, 
    cssClass: prop.css_class,
    scalesWith,
    scaleMultiplier: !isNaN(scaleMultiplier ?? NaN) ? scaleMultiplier : undefined,
    section: sectionType,
    isConditional: shouldMarkConditional || undefined,
    isImportant: isImportant || undefined,
    hasBuiltInCondition: conditionAlreadyInLabel || undefined
  };
}

/**
 * Extract all stats from item properties using tooltip_sections
 */
export function extractStats(
  properties: Record<string, RawItemProperty>, 
  tooltipSections: RawItem['tooltip_sections'], 
  upgrades: RawItem['upgrades']
): StatInfo[] {
  const stats: StatInfo[] = [];
  
  // Build upgrades map for conditional stats
  const upgradesMap = new Map<string, string>();
  for (const upgrade of (upgrades || [])) {
    for (const propUpgrade of (upgrade.property_upgrades || [])) {
      if (propUpgrade.name && propUpgrade.bonus) {
        upgradesMap.set(propUpgrade.name, propUpgrade.bonus);
      }
    }
  }
  
  for (const section of (tooltipSections || [])) {
    const sectionType = section.section_type;
    const isConditional = sectionType === 'conditional';
    
    // Determine which section this belongs to
    // Sections without explicit type default to 'passive' (common for items like Juggernaut)
    let statSection: StatSection = 'innate';
    if (sectionType === 'active') {
      statSection = 'active';
    } else if (sectionType === 'passive' || sectionType === 'conditional' || !sectionType) {
      // No section_type or passive/conditional = passive section
      if (sectionType !== 'innate') {
        statSection = 'passive';
      }
    }
    
    for (const attr of (section.section_attributes || [])) {
      // Process elevated properties (not marked as important)
      for (const propName of (attr.elevated_properties || [])) {
        const stat = extractStat(propName, properties[propName], statSection, upgradesMap, isConditional, false);
        if (stat) stats.push(stat);
      }
      
      // Process important properties (marked as important for conditional logic)
      for (const propName of (attr.important_properties || [])) {
        const stat = extractStat(propName, properties[propName], statSection, upgradesMap, isConditional, true);
        if (stat) stats.push(stat);
      }
      
      // Process regular properties (not marked as important)
      for (const propName of (attr.properties || [])) {
        const stat = extractStat(propName, properties[propName], statSection, upgradesMap, isConditional, false);
        if (stat) stats.push(stat);
      }
    }
  }
  
  return stats;
}

/**
 * Extract descriptions from tooltip_sections or description object
 * Prefers description.desc when it contains rich HTML (with icons/images)
 */
export function extractDescriptions(item: RawItem): { 
  passiveDescription: string; 
  activeDescription: string; 
} {
  const tooltipSections = item.tooltip_sections || [];
  const descObj = item.description || {};
  
  // Check for rich HTML content (icons/images) in various description fields
  const mainDesc = descObj.desc || '';
  const passiveDesc = descObj.passive_desc || descObj.passive || '';
  const activeDesc = descObj.active_desc || descObj.active || '';
  
  const hasRichMainDesc = /<img/i.test(mainDesc) || /<span class="inline-attribute/i.test(mainDesc);
  const hasRichPassiveDesc = /<img/i.test(passiveDesc) || /<span class="inline-attribute/i.test(passiveDesc);
  const hasRichActiveDesc = /<img/i.test(activeDesc) || /<span class="inline-attribute/i.test(activeDesc);
  
  // Also extract from tooltip_sections loc_string
  const passiveDescriptions: string[] = [];
  const activeDescriptions: string[] = [];
  
  for (const section of tooltipSections) {
    const sectionType = section.section_type;
    for (const attr of (section.section_attributes || [])) {
      if (attr.loc_string) {
        if (sectionType === 'active') {
          activeDescriptions.push(attr.loc_string);
        } else if (sectionType === 'passive' || sectionType === 'conditional' || !sectionType) {
          passiveDescriptions.push(attr.loc_string);
        }
      }
    }
  }
  
  const locPassiveDesc = passiveDescriptions.join('<br><br>');
  const locActiveDesc = activeDescriptions.join('<br><br>');
  
  // Determine which source to use for each description
  // Priority: rich content (with icons) > plain desc > loc_string
  const activationType = (item.activation || '').toLowerCase();
  const hasActiveAbility = item.is_active_item === true || 
    (activationType && activationType !== 'none' && activationType !== '' && activationType !== 'passive');
  
  // Check if tooltip_sections only has active sections (for imbue items like Frostbite Charm)
  const hasOnlyActiveSections = tooltipSections.length > 0 && 
    tooltipSections.every((s: any) => s.section_type === 'active');
  
  let finalPassiveDesc = '';
  let finalActiveDesc = '';
  
  // Handle passive description
  // Skip passive if tooltip only has active sections (imbue items)
  if (hasRichPassiveDesc) {
    // Dedicated passive field with rich content
    finalPassiveDesc = passiveDesc;
  } else if (!hasActiveAbility && !hasOnlyActiveSections && hasRichMainDesc) {
    // For passive-only items (not imbues), main desc with rich content goes to passive
    finalPassiveDesc = mainDesc;
  } else if (passiveDesc) {
    // Plain passive description
    finalPassiveDesc = passiveDesc;
  } else if (!hasActiveAbility && !hasOnlyActiveSections && mainDesc) {
    // For passive-only items (not imbues), use main desc
    finalPassiveDesc = mainDesc;
  } else if (locPassiveDesc) {
    // Fallback to loc_string
    finalPassiveDesc = locPassiveDesc;
  }
  
  // Handle active description
  if (hasRichActiveDesc) {
    // Dedicated active field with rich content
    finalActiveDesc = activeDesc;
  } else if ((hasActiveAbility || hasOnlyActiveSections) && hasRichMainDesc) {
    // For active items or imbues with only active sections, main desc goes to active
    finalActiveDesc = mainDesc;
  } else if (activeDesc) {
    // Plain active description
    finalActiveDesc = activeDesc;
  } else if ((hasActiveAbility || hasOnlyActiveSections) && mainDesc) {
    // For active items or imbues, use main desc
    finalActiveDesc = mainDesc;
  } else if (locActiveDesc) {
    // Fallback to loc_string
    finalActiveDesc = locActiveDesc;
  }
  
  // Final fallback: if both are empty, try to use any available description
  if (!finalPassiveDesc && !finalActiveDesc) {
    const anyDesc = mainDesc || passiveDesc || activeDesc || locPassiveDesc || locActiveDesc || 
                    descObj.english || descObj.tooltip || '';
    if (anyDesc) {
      // Put it in passive for passive items, active for active items
      if (hasActiveAbility) {
        finalActiveDesc = anyDesc;
      } else {
        finalPassiveDesc = anyDesc;
      }
    }
  }
  
  return { passiveDescription: finalPassiveDesc, activeDescription: finalActiveDesc };
}

/**
 * Extract ordered content blocks from tooltip_sections, preserving the
 * interleaved description/stats structure for items like Shadow Weave.
 * Returns separate block arrays for active and passive sections.
 */
export function extractContentBlocks(
  properties: Record<string, RawItemProperty>,
  tooltipSections: RawItem['tooltip_sections'],
  upgrades: RawItem['upgrades']
): { activeBlocks: ContentBlock[]; passiveBlocks: ContentBlock[] } {
  const activeBlocks: ContentBlock[] = [];
  const passiveBlocks: ContentBlock[] = [];
  
  // Build upgrades map for conditional stats
  const upgradesMap = new Map<string, string>();
  for (const upgrade of (upgrades || [])) {
    for (const propUpgrade of (upgrade.property_upgrades || [])) {
      if (propUpgrade.name && propUpgrade.bonus) {
        upgradesMap.set(propUpgrade.name, propUpgrade.bonus);
      }
    }
  }
  
  for (const section of (tooltipSections || [])) {
    const sectionType = section.section_type;
    const isConditional = sectionType === 'conditional';
    
    // Determine target block array and stat section
    let targetBlocks: ContentBlock[];
    let statSection: StatSection;
    
    if (sectionType === 'active') {
      targetBlocks = activeBlocks;
      statSection = 'active';
    } else if (sectionType === 'passive' || sectionType === 'conditional' || !sectionType) {
      targetBlocks = passiveBlocks;
      statSection = sectionType === 'innate' ? 'innate' : 'passive';
    } else if (sectionType === 'innate') {
      // innate stats are handled separately by existing rendering, skip for blocks
      continue;
    } else {
      targetBlocks = passiveBlocks;
      statSection = 'passive';
    }
    
    for (const attr of (section.section_attributes || [])) {
      // If this attribute has a loc_string, emit a description block
      if (attr.loc_string) {
        targetBlocks.push({ type: 'description', text: attr.loc_string });
      }
      
      // Collect stats from this attribute's properties
      const attrStats: StatInfo[] = [];
      
      for (const propName of (attr.elevated_properties || [])) {
        const stat = extractStat(propName, properties[propName], statSection, upgradesMap, isConditional, false);
        if (stat) attrStats.push(stat);
      }
      
      for (const propName of (attr.important_properties || [])) {
        const stat = extractStat(propName, properties[propName], statSection, upgradesMap, isConditional, true);
        if (stat) attrStats.push(stat);
      }
      
      for (const propName of (attr.properties || [])) {
        const stat = extractStat(propName, properties[propName], statSection, upgradesMap, isConditional, false);
        if (stat) attrStats.push(stat);
      }
      
      // If we collected any stats, emit a stats block
      if (attrStats.length > 0) {
        targetBlocks.push({ type: 'stats', stats: attrStats });
      }
    }
  }
  
  return { activeBlocks, passiveBlocks };
}

/**
 * Preload an image and return the working URL (or null if failed)
 */
export function preloadImage(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
