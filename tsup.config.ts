import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['./index.ts'],
  outDir: './build',
  clean: true,
  format: 'esm',
  dts: true,
  sourcemap: true,
  target: 'node20',
})
