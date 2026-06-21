import type { NextConfig } from "next";

// Static export for GitHub Pages. Must match REPO_NAME in lib/basePath.ts.
const isProduction = process.env.NODE_ENV === "production";
const repositoryName = "AI-Clipping-Tools";

const nextConfig: NextConfig = {
  output: "export", // emit a static `out/` folder (no Node server needed)
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true, // the Next image optimizer needs a server; disable it
  },
  trailingSlash: true, // makes /page/ -> /page/index.html so refreshes work on Pages
  basePath: isProduction ? `/${repositoryName}` : "",
  assetPrefix: isProduction ? `/${repositoryName}/` : "",
};

export default nextConfig;
