import cloudflare from "@astrojs/cloudflare";

export default {
  output: "server",
  adapter: cloudflare({
    mode: "directory",
  }),
  vite: {
    build: {
      outDir: 'dist'
    }
  }
};