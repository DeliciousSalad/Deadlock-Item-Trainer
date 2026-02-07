import { useState, useRef, useEffect, useCallback } from 'react';
import { hapticTap } from '../utils/haptics';
import { getMusicVolume, setMusicVolume, getSfxVolume, setSfxVolume, onMusicVolumeChange } from '../utils/volume';

// Get the base URL from Vite
const BASE_URL = import.meta.env.BASE_URL || '/';

// Colors for each item type
const typeColors: Record<string, { gradient: string; border: string; glow: string }> = {
  weapon: { 
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #fb923c 100%)',
    border: '#fbbf24',
    glow: 'rgba(245, 158, 11, 0.4)'
  },
  vitality: { 
    gradient: 'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
    border: '#6ee7b7',
    glow: 'rgba(16, 185, 129, 0.4)'
  },
  spirit: { 
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%)',
    border: '#c4b5fd',
    glow: 'rgba(139, 92, 246, 0.4)'
  },
  all: { 
    gradient: 'linear-gradient(135deg, #f7e6cc 0%, #fae9d0 100%)',
    border: '#f7e6cc',
    glow: 'rgba(247, 230, 204, 0.4)'
  },
};

interface MusicPlayerProps {
  autoPlay?: boolean;
  categoryFilter?: 'all' | 'weapon' | 'vitality' | 'spirit';
}

export function MusicPlayer({ autoPlay = false, categoryFilter = 'all' }: MusicPlayerProps) {
  const colors = typeColors[categoryFilter] || typeColors.all;
  const [isOpen, setIsOpen] = useState(false);
  const [musicVol, setMusicVol] = useState(getMusicVolume());
  const [sfxVol, setSfxVol] = useState(getSfxVolume());
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  
  // Use Web Audio API with AudioBufferSourceNode for reliable volume on all browsers
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const pauseTimeRef = useRef<number>(0);

  // Load audio buffer on mount
  useEffect(() => {
    const loadAudio = async () => {
      try {
        const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioContextClass();
        audioContextRef.current = ctx;
        
        // Create gain node
        const gainNode = ctx.createGain();
        gainNode.gain.value = getMusicVolume();
        gainNode.connect(ctx.destination);
        gainNodeRef.current = gainNode;
        
        // Fetch and decode audio
        const audioPath = `${BASE_URL}audio/music.mp3`;
        const response = await fetch(audioPath);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferRef.current = audioBuffer;
        setIsLoaded(true);
      } catch (err) {
        console.error('Failed to load music:', err);
      }
    };
    
    loadAudio();
    
    return () => {
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch { /* ignore */ }
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  // Start playback function
  const startPlayback = useCallback((offset: number = 0) => {
    const ctx = audioContextRef.current;
    const buffer = audioBufferRef.current;
    const gainNode = gainNodeRef.current;
    
    if (!ctx || !buffer || !gainNode) return;
    
    // Resume context if suspended
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // Stop existing source
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch { /* ignore */ }
    }
    
    // Create new source
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gainNode);
    source.start(0, offset % buffer.duration);
    sourceNodeRef.current = source;
    startTimeRef.current = ctx.currentTime - offset;
  }, []);

  // Auto-play when autoPlay becomes true and audio is loaded
  useEffect(() => {
    if (autoPlay && isLoaded && !isPlaying && audioBufferRef.current && musicVol > 0) {
      startPlayback(pauseTimeRef.current);
      setIsPlaying(true);
    }
  }, [autoPlay, isLoaded, isPlaying, startPlayback, musicVol]);

  const handleMusicVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setMusicVol(vol);
    setMusicVolume(vol);
    
    // Update gain node
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = vol;
    }
    
    // Handle play/pause based on volume
    if (vol === 0) {
      // Pause: save current position and stop
      if (sourceNodeRef.current && audioContextRef.current) {
        pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
        try { sourceNodeRef.current.stop(); } catch { /* ignore */ }
        sourceNodeRef.current = null;
      }
      setIsPlaying(false);
    } else if (!isPlaying && audioBufferRef.current) {
      // Resume from saved position
      startPlayback(pauseTimeRef.current);
      setIsPlaying(true);
    }
  }, [isPlaying, startPlayback]);

  // Sync when XR slider (or any external caller) changes the global music volume
  useEffect(() => {
    return onMusicVolumeChange((vol) => {
      setMusicVol(vol);
      if (gainNodeRef.current) {
        gainNodeRef.current.gain.value = vol;
      }
      if (vol === 0) {
        if (sourceNodeRef.current && audioContextRef.current) {
          pauseTimeRef.current = audioContextRef.current.currentTime - startTimeRef.current;
          try { sourceNodeRef.current.stop(); } catch { /* ignore */ }
          sourceNodeRef.current = null;
        }
        setIsPlaying(false);
      } else if (!isPlaying && audioBufferRef.current) {
        startPlayback(pauseTimeRef.current);
        setIsPlaying(true);
      }
    });
  }, [isPlaying, startPlayback]);

  const handleSfxVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    setSfxVol(vol);
    setSfxVolume(vol);
  }, []);

  const togglePanel = () => {
    hapticTap();
    setIsOpen(!isOpen);
  };

  const hasSound = musicVol > 0 || sfxVol > 0;

  return (
    <div
      style={{
        position: 'fixed',
        top: '10px',
        right: '10px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: '8px',
      }}
    >
      {/* Toggle button */}
      <button
        onClick={togglePanel}
        style={{
          width: '36px',
          height: '36px',
          borderRadius: '50%',
          background: hasSound 
            ? colors.gradient 
            : 'rgba(40, 40, 40, 0.9)',
          border: hasSound 
            ? `2px solid ${colors.border}` 
            : '2px solid rgba(255,255,255,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          boxShadow: hasSound 
            ? `0 0 20px ${colors.glow}` 
            : '0 2px 10px rgba(0,0,0,0.5)',
        }}
        title="Sound settings"
      >
        {hasSound ? (
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="#000" 
            strokeWidth="2"
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" fill="#000" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          </svg>
        ) : (
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="rgba(255,255,255,0.6)" 
            strokeWidth="2"
            strokeLinecap="round" 
            strokeLinejoin="round"
          >
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        )}
      </button>

      {/* Volume panel */}
      {isOpen && (
        <div
          style={{
            background: 'rgba(20, 20, 25, 0.95)',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            minWidth: '180px',
          }}
        >
          {/* Music volume */}
          <div style={{ marginBottom: '12px' }}>
            <label 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                color: '#e8a849',
                fontSize: '12px',
                fontWeight: 'bold',
                marginBottom: '6px',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
              Music
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={musicVol}
              onChange={handleMusicVolume}
              style={{
                width: '100%',
                accentColor: '#e8a849',
                cursor: 'pointer',
              }}
            />
          </div>

          {/* SFX volume */}
          <div>
            <label 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                color: '#5eead4',
                fontSize: '12px',
                fontWeight: 'bold',
                marginBottom: '6px',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              SFX
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={sfxVol}
              onChange={handleSfxVolume}
              style={{
                width: '100%',
                accentColor: '#5eead4',
                cursor: 'pointer',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
