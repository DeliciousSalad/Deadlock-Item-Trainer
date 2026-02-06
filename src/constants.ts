// Shared constants for the Deadlock Flashcards app

// Colors for each item type (matching game/statlocker)
export const TYPE_COLORS: Record<string, { 
  bg: string; 
  border: string;
  glow: string;
}> = {
  weapon: {
    bg: '#3d2a1a',
    border: '#D4883A',
    glow: 'rgba(212, 136, 58, 0.6)',
  },
  vitality: {
    bg: '#1e3320',
    border: '#4CAF50',
    glow: 'rgba(76, 175, 80, 0.6)',
  },
  spirit: {
    bg: '#2a2040',
    border: '#9C6FDF',
    glow: 'rgba(156, 111, 223, 0.6)',
  },
};

// Map API scale types to friendly display names
export const SCALE_TYPE_MAP: Record<string, string> = {
  'ETechDuration': 'Spirit',
  'ETechRange': 'Spirit',
  'ETechPower': 'Spirit',
  'EWeaponDamage': 'Weapon',
  'EBulletDamage': 'Weapon',
  'EBaseAttackDamage': 'Weapon',
  'EMaxHealth': 'Max Health',
  'EHealthRegen': 'Health Regen',
  'EBulletResist': 'Bullet Resist',
  'ESpiritResist': 'Spirit Resist',
  'EMoveSpeed': 'Move Speed',
  'EItemCooldown': 'Item Cooldown',
  'EAbilityCooldown': 'Ability Cooldown',
  'EChannelDuration': 'Channel Duration',
};

// API endpoint
export const ITEMS_API_URL = 'https://assets.deadlock-api.com/v2/items/by-type/upgrade';
