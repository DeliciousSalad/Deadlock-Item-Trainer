import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

const isGitHubPages = process.env.DEPLOY_TARGET === 'ghpages';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  // Use '/DeadlockFlashcards/' for GitHub Pages, '/' for Cloudflare Pages / custom domain
  base: isGitHubPages ? '/DeadlockFlashcards/' : '/',
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
