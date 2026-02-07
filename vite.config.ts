import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  base: '/DeadlockFlashcards/', // Your repo name
  server: {
    host: true, // Expose to local network
    hmr: false, // Disable HMR to prevent unwanted refreshes on mobile
    proxy: {
      // Proxy image requests to Deadlock API CDN to avoid CORS issues
      // (WebGL textures require CORS-clean images; the CDN doesn't send CORS headers)
      '/_img-proxy': {
        target: 'https://assets-bucket.deadlock-api.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/_img-proxy/, ''),
        secure: false,
      },
    },
  },
})
