/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: "/lol-aram-guide",
  assetPrefix: "/lol-aram-guide/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
