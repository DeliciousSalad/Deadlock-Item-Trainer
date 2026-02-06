// Global volume settings
let musicVolume = 0.3;
let sfxVolume = 0.5;

// Callbacks to notify when volume changes
const musicListeners: ((vol: number) => void)[] = [];

export function getMusicVolume(): number {
  return musicVolume;
}

export function setMusicVolume(vol: number): void {
  musicVolume = Math.max(0, Math.min(1, vol));
  musicListeners.forEach(cb => cb(musicVolume));
}

export function onMusicVolumeChange(callback: (vol: number) => void): () => void {
  musicListeners.push(callback);
  return () => {
    const index = musicListeners.indexOf(callback);
    if (index > -1) musicListeners.splice(index, 1);
  };
}

export function getSfxVolume(): number {
  return sfxVolume;
}

export function setSfxVolume(vol: number): void {
  sfxVolume = Math.max(0, Math.min(1, vol));
}
