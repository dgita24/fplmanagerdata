import cloudflare from "@astrojs/cloudflare";

export default {
  output: "server",
  adapter: cloudflare(),
};
