import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/DeadlockFlashcards/', // Your repo name
  server: {
    host: true, // Expose to local network
    hmr: false, // Disable HMR to prevent unwanted refreshes on mobile
  },
})
