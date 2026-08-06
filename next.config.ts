import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Default bottom-left dev route indicator collides with the new mobile
  // bottom tab bar; move it up by the profile avatar instead. Dev-only,
  // never renders in production.
  devIndicators: {
    position: 'top-left',
  },
  // Lets phones on the LAN load the dev server via its IP instead of
  // localhost — otherwise Next.js blocks cross-origin requests to dev-only
  // assets/endpoints (client-side navigation, Server Actions), which is why
  // buttons that hit the server silently do nothing from another device.
  // Wildcarded to the last octet so it survives DHCP reassigning this
  // machine's IP; only needs updating if the network/subnet itself changes
  // (e.g. 192.168.68.x -> 192.168.1.x).
  allowedDevOrigins: ['192.168.68.*'],
  experimental: {
    serverActions: {
      allowedOrigins: ['192.168.68.*:4000'],
    },
  },
};

export default nextConfig;
