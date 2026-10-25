import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A package-lock.json above this repo, such as one left in the home
// directory, makes Next warn on startup. Keep the root at this project.
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  turbopack: {
    root: projectRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
