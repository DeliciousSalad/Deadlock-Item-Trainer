// Sound utilities for hover and active card effects
// Includes spatial (3D) audio variants for WebXR
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
      audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
  }
  // Resume if suspended (happens on some browsers after idle)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  // Start a silent keep-alive so Quest doesn't re-suspend the context
  ensureKeepAlive(audioContext);
  return audioContext;
}

/**
 * Prevent the browser from suspending the AudioContext between interactions.
 * Plays a silent oscillator at zero gain — costs nothing but keeps the
 * audio thread alive so subsequent source.start() calls play instantly.
 */
let keepAliveStarted = false;
function ensureKeepAlive(ctx: AudioContext) {
  if (keepAliveStarted) return;
  keepAliveStarted = true;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;          // completely silent
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    // osc runs forever — ~0 CPU cost because gain is 0
  } catch { /* ignore */ }
}

// ── Buffer cache: decode once per file, play instantly forever after ──
const bufferCache = new Map<string, AudioBuffer>();

/** Pre-decode a sound file into the cache (non-blocking) */
function warmBuffer(soundPath: string) {
  if (bufferCache.has(soundPath)) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  fetch(soundPath)
    .then(r => r.arrayBuffer())
    .then(ab => ctx.decodeAudioData(ab))
    .then(buf => bufferCache.set(soundPath, buf))
    .catch(() => {});
}

/** Warm the cache for all sound files (call after first user gesture) */
let warmed = false;
function warmAllBuffers() {
  if (warmed) return;
  warmed = true;
  const base = import.meta.env.BASE_URL || '/';
  // Stagger loads: 2 per 50ms to avoid overwhelming Quest
  const paths: string[] = [];
  for (const [type, count] of Object.entries(SOUND_COUNTS)) {
    for (let i = 1; i <= count; i++) {
      paths.push(`${base}audio/sounds/ui_shop_mod_hover_${type}_${i.toString().padStart(2, '0')}.wav`);
    }
  }
  for (const name of ['starred', 'weapon', 'vitality', 'magic']) {
    paths.push(`${base}audio/sounds/ui_shop_panel_${name}.wav`);
  }
  let idx = 0;
  (function batch() {
    // Load 4 files per tick — WAVs are small and decode fast
    for (let n = 0; n < 4 && idx < paths.length; n++, idx++) warmBuffer(paths[idx]);
    if (idx < paths.length) setTimeout(batch, 30);
  })();
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
  return `${base}audio/sounds/ui_shop_mod_hover_${type}_${paddedIndex}.wav`;
}

/**
 * Play a sound at the specified volume multiplier using Web Audio API.
 * If the buffer is pre-cached, plays synchronously (instant on Quest).
 * Otherwise falls back to async fetch+decode (slight delay on first play).
 */
function playSound(type: string, volumeMultiplier: number) {
  const sfxVolume = getSfxVolume();
  if (sfxVolume === 0) return;
  
  // Kick off background warm on first interaction
  if (!warmed) warmAllBuffers();

  const validType = SOUND_COUNTS[type] ? type : 'weapon';
  const soundPath = getRandomSoundPath(validType);
  const volume = sfxVolume * volumeMultiplier;
  
  const ctx = getAudioContext();
  if (!ctx) {
    playWithHtml5Audio(soundPath, volume);
    return;
  }

  // ── Fast path: buffer already decoded → instant playback ──
  const cached = bufferCache.get(soundPath);
  if (cached) {
    try {
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      gainNode.connect(ctx.destination);
      const source = ctx.createBufferSource();
      source.buffer = cached;
      source.connect(gainNode);
      source.start(0);
    } catch { /* ignore */ }
    return;
  }

  // ── Slow path: fetch + decode + play + cache for next time ──
  (async () => {
    try {
      const response = await fetch(soundPath);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      bufferCache.set(soundPath, audioBuffer);

      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      gainNode.connect(ctx.destination);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      source.start(0);
    } catch {
      playWithHtml5Audio(soundPath, volume);
    }
  })();
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

export function playCategorySound(category: 'all' | 'weapon' | 'vitality' | 'spirit') {
  const sfxVolume = getSfxVolume();
  if (sfxVolume === 0) return;

  if (!warmed) warmAllBuffers();
  
  const soundNameMap: Record<string, string> = {
    all: 'starred',
    weapon: 'weapon',
    vitality: 'vitality',
    spirit: 'magic',
  };
  const soundName = soundNameMap[category] || category;
  const base = import.meta.env.BASE_URL || '/';
  const soundPath = `${base}audio/sounds/ui_shop_panel_${soundName}.wav`;
  const volume = sfxVolume * PANEL_MULTIPLIER;
  
  const ctx = getAudioContext();
  if (!ctx) {
    playWithHtml5Audio(soundPath, volume);
    return;
  }

  // Fast path
  const cached = bufferCache.get(soundPath);
  if (cached) {
    try {
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      gainNode.connect(ctx.destination);
      const source = ctx.createBufferSource();
      source.buffer = cached;
      source.connect(gainNode);
      source.start(0);
    } catch { /* ignore */ }
    return;
  }

  // Slow path
  (async () => {
    try {
      const response = await fetch(soundPath);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      bufferCache.set(soundPath, audioBuffer);

      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      gainNode.connect(ctx.destination);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(gainNode);
      source.start(0);
    } catch {
      playWithHtml5Audio(soundPath, volume);
    }
  })();
}

/* ═══════════════════════════════════════════════════
   SPATIAL (3D) AUDIO — for WebXR
   Uses PannerNode for positional sound in 3D space.
   Position is [x, y, z] in world coordinates.
   ═══════════════════════════════════════════════════ */

export type SpatialPosition = [number, number, number];

/**
 * Play a sound spatialized at the given 3D position.
 * The AudioContext listener is automatically synced to the XR camera.
 */
function playSpatialSound(
  soundPath: string,
  volumeMultiplier: number,
  position: SpatialPosition,
) {
  const sfxVolume = getSfxVolume();
  if (sfxVolume === 0) return;

  if (!warmed) warmAllBuffers();

  const ctx = getAudioContext();
  if (!ctx) {
    playWithHtml5Audio(soundPath, sfxVolume * volumeMultiplier);
    return;
  }

  const volume = sfxVolume * volumeMultiplier;

  const playBuffer = (audioBuffer: AudioBuffer) => {
    try {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 5;
      panner.maxDistance = 20;
      panner.rolloffFactor = 0.3;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;
      panner.positionX.setValueAtTime(position[0], ctx.currentTime);
      panner.positionY.setValueAtTime(position[1], ctx.currentTime);
      panner.positionZ.setValueAtTime(position[2], ctx.currentTime);

      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(panner);
      panner.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start(0);
    } catch { /* ignore */ }
  };

  // Fast path
  const cached = bufferCache.get(soundPath);
  if (cached) {
    playBuffer(cached);
    return;
  }

  // Slow path
  (async () => {
    try {
      const response = await fetch(soundPath);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      bufferCache.set(soundPath, audioBuffer);
      playBuffer(audioBuffer);
    } catch {
      playWithHtml5Audio(soundPath, volume);
    }
  })();
}

/**
 * Play a type-based sound spatialized at a 3D position.
 */
function playSpatialTypeSound(type: string, volumeMultiplier: number, position: SpatialPosition) {
  const validType = SOUND_COUNTS[type] ? type : 'weapon';
  const soundPath = getRandomSoundPath(validType);
  playSpatialSound(soundPath, volumeMultiplier, position);
}

/** Spatial hover sound — plays at the card's 3D position */
export function playSpatialHoverSound(type: string, position: SpatialPosition) {
  playSpatialTypeSound(type, HOVER_MULTIPLIER, position);
}

/** Spatial flip sound — plays at the card's 3D position */
export function playSpatialFlipSound(type: string, position: SpatialPosition) {
  playSpatialTypeSound(type, FLIP_MULTIPLIER, position);
}

/** Spatial active card change sound — debounced, plays at card's 3D position */
let lastSpatialActiveSoundTime = 0;

export function playSpatialActiveSound(type: string, position: SpatialPosition) {
  const now = Date.now();
  if (now - lastSpatialActiveSoundTime < ACTIVE_SOUND_DEBOUNCE_MS) return;
  lastSpatialActiveSoundTime = now;
  playSpatialTypeSound(type, ACTIVE_MULTIPLIER, position);
}

/** Spatial category panel switch sound */
export function playSpatialCategorySound(
  category: 'all' | 'weapon' | 'vitality' | 'spirit',
  position: SpatialPosition,
) {
  const soundNameMap: Record<string, string> = {
    all: 'starred',
    weapon: 'weapon',
    vitality: 'vitality',
    spirit: 'magic',
  };
  const soundName = soundNameMap[category] || category;
  const base = import.meta.env.BASE_URL || '/';
  const soundPath = `${base}audio/sounds/ui_shop_panel_${soundName}.wav`;
  playSpatialSound(soundPath, PANEL_MULTIPLIER, position);
}

/**
 * Update the AudioContext listener position/orientation to match the XR camera.
 * Call this every frame from a useFrame hook when in XR mode.
 */
export function updateAudioListenerFromCamera(
  position: { x: number; y: number; z: number },
  forward: { x: number; y: number; z: number },
  up: { x: number; y: number; z: number },
) {
  if (!audioContext) return;

  const listener = audioContext.listener;
  const t = audioContext.currentTime;
  if (listener.positionX) {
    // Modern API
    listener.positionX.setValueAtTime(position.x, t);
    listener.positionY.setValueAtTime(position.y, t);
    listener.positionZ.setValueAtTime(position.z, t);
    listener.forwardX.setValueAtTime(forward.x, t);
    listener.forwardY.setValueAtTime(forward.y, t);
    listener.forwardZ.setValueAtTime(forward.z, t);
    listener.upX.setValueAtTime(up.x, t);
    listener.upY.setValueAtTime(up.y, t);
    listener.upZ.setValueAtTime(up.z, t);
  } else {
    // Legacy API fallback
    listener.setPosition(position.x, position.y, position.z);
    listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}
