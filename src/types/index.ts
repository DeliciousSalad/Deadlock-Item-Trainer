// Shared type definitions for the Deadlock Flashcards app

export type StatSection = 'innate' | 'passive' | 'active';

export type ItemCategory = 'all' | 'weapon' | 'vitality' | 'spirit';

export interface StatInfo {
  label: string;
  value: string;
  icon?: string;
  cssClass?: string;
  scalesWith?: string;
  scaleMultiplier?: number;
  section: StatSection;
  isConditional?: boolean;
  hasBuiltInCondition?: boolean; // True when condition is already in the label (e.g., "vs. NPCs")
  isImportant?: boolean; // True when stat is from important_properties array
}

export type ContentBlock = 
  | { type: 'description'; text: string }
  | { type: 'stats'; stats: StatInfo[] };

export interface ComponentItem {
  id: number;
  name: string;
}

export interface ProcessedItem {
  id: number;
  name: string;
  displayName: string;
  image: string;
  fallbackImage?: string;
  type: string;
  tier: number;
  cost: number;
  stats: StatInfo[];
  passiveDescription?: string;
  activeDescription?: string;
  activeBlocks?: ContentBlock[];
  passiveBlocks?: ContentBlock[];
  hasPassiveSection: boolean;
  activation?: string;
  isActive: boolean;
  isImbue: boolean;
  cooldown?: string;
  passiveCooldown?: string;
  componentItems: ComponentItem[];
  upgradesTo: ComponentItem[];
}

// Raw API types (partial, for the fields we use)
export interface RawItemProperty {
  value?: string | number;
  label?: string;
  prefix?: string;
  postfix?: string;
  icon?: string;
  css_class?: string;
  usage_flags?: string[];
  conditional?: string; // Describes when this applies (e.g., "against NPCs") - if present, condition is in label
  scale_function?: {
    specific_stat_scale_type?: string;
    scaling_stats?: string[];
    stat_scale?: number;
    scale_value?: number;
    bonus_scale?: number;
  };
}

export interface RawTooltipSection {
  section_type: string;
  section_attributes?: Array<{
    loc_string?: string;
    properties?: string[];
    elevated_properties?: string[];
    important_properties?: string[];
  }>;
}

export interface RawItem {
  id: number;
  class_name: string;
  name?: string;
  shop_image?: string;
  shop_image_webp?: string;
  item_slot_type?: string;
  item_tier?: number;
  cost?: number;
  shopable?: boolean;
  disabled?: boolean;
  is_active_item?: boolean;
  imbue?: boolean;
  activation?: string;
  description?: {
    desc?: string;
    passive_desc?: string;
    passive?: string;
    active_desc?: string;
    active?: string;
    english?: string;
    tooltip?: string;
  };
  properties?: Record<string, RawItemProperty>;
  tooltip_sections?: RawTooltipSection[];
  upgrades?: Array<{
    property_upgrades?: Array<{
      name: string;
      bonus: string;
    }>;
  }>;
  component_items?: string[];
}
