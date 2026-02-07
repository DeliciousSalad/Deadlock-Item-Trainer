/**
 * On-screen debug overlay that captures console.log/warn/error
 * and displays them in a fixed HTML overlay — useful for debugging
 * on devices without easy DevTools access (e.g. Quest browser).
 */
import { useState, useEffect, useRef } from 'react';

export function DebugOverlay() {
  const [logs, setLogs] = useState<string[]>([]);
  const [visible, setVisible] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const addLog = (level: string, ...args: any[]) => {
      const msg = `[${level}] ${args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch { return String(a); }
      }).join(' ')}`;
      setLogs(prev => [...prev.slice(-80), msg]);
    };

    const origLog = console.log;
    const origWarn = console.warn;
    const origError = console.error;

    console.log = (...args) => { origLog(...args); addLog('LOG', ...args); };
    console.warn = (...args) => { origWarn(...args); addLog('WARN', ...args); };
    console.error = (...args) => { origError(...args); addLog('ERR', ...args); };

    return () => {
      console.log = origLog;
      console.warn = origWarn;
      console.error = origError;
    };
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 99999,
      pointerEvents: 'auto',
    }}>
      <button
        onClick={() => setVisible(v => !v)}
        style={{
          position: 'absolute',
          top: visible ? '-28px' : '-28px',
          right: '8px',
          background: '#333',
          color: '#fff',
          border: 'none',
          borderRadius: '4px 4px 0 0',
          padding: '4px 12px',
          fontSize: '12px',
          cursor: 'pointer',
        }}
      >
        {visible ? 'Hide' : 'Show'} Debug
      </button>
      {visible && (
        <div
          ref={containerRef}
          style={{
            maxHeight: '200px',
            overflow: 'auto',
            background: 'rgba(0,0,0,0.85)',
            color: '#0f0',
            fontFamily: 'monospace',
            fontSize: '11px',
            padding: '8px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {logs.length === 0 && <div style={{ color: '#666' }}>No logs yet...</div>}
          {logs.map((log, i) => (
            <div key={i} style={{
              color: log.startsWith('[ERR]') ? '#f55' : log.startsWith('[WARN]') ? '#ff0' : '#0f0',
              borderBottom: '1px solid rgba(255,255,255,0.05)',
              padding: '1px 0',
            }}>
              {log}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
