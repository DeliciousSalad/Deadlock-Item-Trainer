interface IntroScreenProps {
  onStart: () => void;
}

export function IntroScreen({ onStart }: IntroScreenProps) {
  return (
    <div 
      className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{
        background: `
          linear-gradient(160deg, rgba(10, 22, 18, 0.6) 0%, rgba(13, 26, 22, 0.65) 40%, rgba(17, 26, 20, 0.65) 70%, rgba(10, 15, 13, 0.7) 100%),
          url(${import.meta.env.BASE_URL}images/bg.png)
        `,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      
      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <img 
            src={`${import.meta.env.BASE_URL}images/logo_deadlock_mark_only_png.png`}
            alt="Deadlock"
            className="w-24 h-24 md:w-32 md:h-32"
            style={{ filter: 'brightness(0) saturate(100%) invert(93%) sepia(10%) saturate(400%) hue-rotate(330deg)' }}
          />
          <img 
            src={`${import.meta.env.BASE_URL}images/logo_deadlock_word_only_png.png`}
            alt="Deadlock"
            className="h-8 md:h-10"
            style={{ filter: 'brightness(0) saturate(100%) invert(93%) sepia(10%) saturate(400%) hue-rotate(330deg)' }}
          />
          <span 
            className="text-xl md:text-2xl font-bold"
            style={{ 
              fontFamily: 'Georgia, "Times New Roman", serif',
              color: '#e8a849',
            }}
          >
            Item Trainer
          </span>
        </div>
        
        {/* Description */}
        <p className="text-white/60 text-sm md:text-base max-w-sm">
          Learn all the items in Deadlock with interactive flashcards
        </p>
        
        {/* Start Button */}
        <button
          onClick={onStart}
          className="px-8 py-4 rounded-xl text-lg font-bold transition-all duration-200
                     hover:scale-105 active:scale-95"
          style={{
            background: 'linear-gradient(135deg, #e8a849 0%, #c98a2e 100%)',
            color: '#1a1a1a',
            boxShadow: '0 4px 20px rgba(232, 168, 73, 0.3)',
          }}
        >
          Start Learning
        </button>
        
        {/* Audio note */}
        <p className="text-white/40 text-xs">
          🔊 This app includes sound effects and music
        </p>
      </div>
      
      {/* Footer */}
      <div 
        className="absolute bottom-4"
        style={{ 
          textAlign: 'center', 
          color: '#4b5563', 
          fontSize: '10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '4px',
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: '4px',
        }}>
          <span style={{ color: '#6b7280' }}>Made by</span>
          <a
            href="https://x.com/salad_vr"
            target="_blank"
            rel="noopener noreferrer"
            style={{ 
              color: '#32A90D', 
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <img 
              src={`${import.meta.env.BASE_URL}images/salad_logo_small.png`}
              alt="Salad Logo" 
              style={{ height: '14px', width: 'auto' }}
            />
            DeliciousSalad
          </a>
        </div>
        <p style={{ margin: 0 }}>
          Data from{' '}
          <a
            href="https://deadlock-api.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#5eead4' }}
          >
            Deadlock API
          </a>
          {' '}• Not affiliated with Valve Corporation
        </p>
      </div>
    </div>
  );
}
