import { useState, useEffect } from 'react';
import { xrStore } from './xrStore';
import type { ItemCategory } from '../../types';

const TYPE_THEME: Record<string, { grad0: string; grad1: string; border: string; glow: string }> = {
  all:      { grad0: '#92713a', grad1: '#b8943e', border: '#d4b16a', glow: 'rgba(212, 177, 106, 0.3)' },
  weapon:   { grad0: '#d97706', grad1: '#f59e0b', border: '#fbbf24', glow: 'rgba(245, 158, 11, 0.4)' },
  vitality: { grad0: '#059669', grad1: '#10b981', border: '#6ee7b7', glow: 'rgba(16, 185, 129, 0.4)' },
  spirit:   { grad0: '#7c3aed', grad1: '#8b5cf6', border: '#a78bfa', glow: 'rgba(139, 92, 246, 0.4)' },
};

interface XRButtonProps {
  onEnterXR: () => void;
  category?: ItemCategory;
}

export function XRButton({ onEnterXR, category = 'all' }: XRButtonProps) {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);

  const [sessionMode, setSessionMode] = useState<'immersive-ar' | 'immersive-vr'>('immersive-ar');

  useEffect(() => {
    if (!navigator.xr) {
      setIsSupported(false);
      return;
    }

    let cancelled = false;

    // Check immersive-ar first, fall back to immersive-vr (Safari/visionOS uses VR with passthrough)
    navigator.xr.isSessionSupported('immersive-ar')
      .then((arSupported) => {
        if (cancelled) return;
        if (arSupported) {
          setSessionMode('immersive-ar');
          setIsSupported(true);
        } else {
          return navigator.xr!.isSessionSupported('immersive-vr').then((vrSupported) => {
            if (!cancelled) {
              setSessionMode('immersive-vr');
              setIsSupported(vrSupported);
            }
          });
        }
      })
      .catch(() => {
        // Retry once after a short delay (some browsers need a moment)
        setTimeout(() => {
          if (cancelled) return;
          navigator.xr!.isSessionSupported('immersive-ar')
            .then((ar) => {
              if (cancelled) return;
              if (ar) { setSessionMode('immersive-ar'); setIsSupported(true); return; }
              return navigator.xr!.isSessionSupported('immersive-vr').then((vr) => {
                if (!cancelled) { setSessionMode('immersive-vr'); setIsSupported(vr); }
              });
            })
            .catch(() => { if (!cancelled) setIsSupported(false); });
        }, 1000);
      });

    return () => { cancelled = true; };
  }, []);

  if (isSupported !== true) return null;

  const handleClick = () => {
    // Guard: don't re-enter if a session is still winding down
    const existing = xrStore.getState().session;
    if (existing) return;

    // Call onEnterXR synchronously from the user gesture to mount the Canvas.
    // Then request the XR session via the store.
    onEnterXR();
    const enterFn = sessionMode === 'immersive-vr' ? xrStore.enterVR : xrStore.enterAR;
    enterFn().catch((err) => {
      console.error('Failed to enter XR:', err);
    });
  };

  const theme = TYPE_THEME[category] || TYPE_THEME.all;

  return (
    <button
      onClick={handleClick}
      style={{
        position: 'fixed',
        top: '10px',
        left: '10px',
        zIndex: 9998,
        borderRadius: '10px',
        background: `linear-gradient(135deg, ${theme.grad0} 0%, ${theme.grad1} 100%)`,
        border: `1.5px solid ${theme.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
        padding: '5px 10px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        boxShadow: `0 0 12px ${theme.glow}`,
      }}
      title="Enter XR Mode (Experimental)"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flexShrink: 0 }}
      >
        <path d="M2 8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8z" />
        <path d="M6 6v-2" />
        <path d="M18 6v-2" />
        <circle cx="8" cy="12" r="2" />
        <circle cx="16" cy="12" r="2" />
        <path d="M10 12h4" />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
        <span style={{
          color: '#fff',
          fontSize: '11px',
          fontWeight: 700,
          lineHeight: 1.1,
          letterSpacing: '0.02em',
        }}>
          Enter XR
        </span>
        <span style={{
          color: 'rgba(255,255,255,0.5)',
          fontSize: '8px',
          fontWeight: 500,
          lineHeight: 1.1,
        }}>
          Experimental
        </span>
      </div>
    </button>
  );
}
