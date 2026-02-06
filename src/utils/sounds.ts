// Sound utilities for hover and active card effects
import { getSfxVolume } from './volume';

// Sound file counts per type
const SOUND_COUNTS: Record<string, number> = {
  weapon: 11,
  vitality: 10,
  spirit: 11,
};

// Relative volume multipliers (applied to global SFX volume)
const HOVER_MULTIPLIER = 0.3;
const FLIP_MULTIPLIER = 0.5;
const ACTIVE_MULTIPLIER = 0.7;

// Shared AudioContext for SFX (initialized on first use after user interaction)
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (!audioContext) {
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioContext = new AudioContextClass();
    } catch {
      return null;
    }
  }
  // Resume if suspended (happens on some browsers after idle)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

/**
 * Get a random sound file path for the given item type
 */
function getRandomSoundPath(type: string): string {
  const count = SOUND_COUNTS[type] || 10;
  const index = Math.floor(Math.random() * count) + 1;
  const paddedIndex = index.toString().padStart(2, '0');
  // Use import.meta.env.BASE_URL to handle base path in production
  const base = import.meta.env.BASE_URL || '/';
  return `${base}audio/sounds/ui_shop_mod_hover_${type}_${paddedIndex}.mp3`;
}

/**
 * Play a sound at the specified volume multiplier using Web Audio API
 */
async function playSound(type: string, volumeMultiplier: number) {
  const sfxVolume = getSfxVolume();
  if (sfxVolume === 0) return; // Skip if muted
  
  const validType = SOUND_COUNTS[type] ? type : 'weapon';
  const soundPath = getRandomSoundPath(validType);
  
  const ctx = getAudioContext();
  
  if (ctx) {
    // Use Web Audio API for Safari compatibility
    try {
      const response = await fetch(soundPath);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      // Create gain node for volume control
      const gainNode = ctx.createGain();
      gainNode.gain.value = sfxVolume * volumeMultiplier;
      gainNode.connect(ctx.destination);
      
      // Create and play buffer source
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      source.start(0);
    } catch {
      // Fallback to HTML5 Audio
      playWithHtml5Audio(soundPath, sfxVolume * volumeMultiplier);
    }
  } else {
    // Fallback to HTML5 Audio
    playWithHtml5Audio(soundPath, sfxVolume * volumeMultiplier);
  }
}

function playWithHtml5Audio(soundPath: string, volume: number) {
  const audio = new Audio(soundPath);
  audio.volume = volume;
  audio.play().catch(() => {
    // Ignore autoplay errors
  });
}

/**
 * Play a quiet hover sound for the given item type
 */
export function playHoverSound(type: string) {
  playSound(type, HOVER_MULTIPLIER);
}

/**
 * Play a medium sound when flipping a card
 */
export function playFlipSound(type: string) {
  playSound(type, FLIP_MULTIPLIER);
}

/**
 * Play a louder sound when the active card changes
 * Debounced to prevent double-play on Safari
 */
let lastActiveSoundTime = 0;
const ACTIVE_SOUND_DEBOUNCE_MS = 150;

export function playActiveSound(type: string) {
  const now = Date.now();
  if (now - lastActiveSoundTime < ACTIVE_SOUND_DEBOUNCE_MS) {
    return; // Skip if played recently
  }
  lastActiveSoundTime = now;
  playSound(type, ACTIVE_MULTIPLIER);
}

/**
 * Play the panel switch sound when changing category filter
 */
const PANEL_MULTIPLIER = 0.6;

export async function playCategorySound(category: 'all' | 'weapon' | 'vitality' | 'spirit') {
  const sfxVolume = getSfxVolume();
  if (sfxVolume === 0) return;
  
  // Map category to sound file name
  const soundNameMap: Record<string, string> = {
    all: 'starred',
    weapon: 'weapon',
    vitality: 'vitality',
    spirit: 'magic',
  };
  const soundName = soundNameMap[category] || category;
  const base = import.meta.env.BASE_URL || '/';
  const soundPath = `${base}audio/sounds/ui_shop_panel_${soundName}.mp3`;
  
  const ctx = getAudioContext();
  
  if (ctx) {
    try {
      const response = await fetch(soundPath);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      const gainNode = ctx.createGain();
      gainNode.gain.value = sfxVolume * PANEL_MULTIPLIER;
      gainNode.connect(ctx.destination);
      
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      source.start(0);
    } catch {
      playWithHtml5Audio(soundPath, sfxVolume * PANEL_MULTIPLIER);
    }
  } else {
    playWithHtml5Audio(soundPath, sfxVolume * PANEL_MULTIPLIER);
  }
}
