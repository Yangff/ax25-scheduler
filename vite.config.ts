import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import conventionsPlugin from './vite-plugin-conventions'
import versionPlugin from './vite-plugin-version'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), conventionsPlugin(), versionPlugin()],
  base: '/ax25-scheduler/',
})
