import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves the app from https://<user>.github.io/<repo>/, so every asset URL
// needs the repo name as a prefix. Case matters: the repo is `carbooker`, and
// `/Carbooker/` would 404 every asset. Change this if the repository is renamed.
export default defineConfig({
  base: '/carbooker/',
  plugins: [react()],
})
