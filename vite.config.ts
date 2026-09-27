import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, lazyPlugins } from "vite-plus";

export default defineConfig({
  // Relative base so the built bundle also works from a custom scheme (Electron).
  base: "./",
  plugins: lazyPlugins(() => [svelte()]),
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3456",
    },
  },
  build: {
    outDir: "dist",
  },
  test: {
    include: ["tests/**/*.test.ts"],
  },
  fmt: {},
  lint: {
    ignorePatterns: ["dist/**", "data/**"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
