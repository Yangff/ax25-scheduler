import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import conventionsPlugin from './vite-plugin-conventions'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), conventionsPlugin()],
  base: '/ax25-scheduler/',
})
