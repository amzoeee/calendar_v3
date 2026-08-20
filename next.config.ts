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
  // Wildcarded so it survives DHCP reassigning this machine's IP; only needs
  // updating if the network/subnet itself changes. That has now happened once
  // (192.168.68.x -> 172.26.x.x), which is exactly what this comment warned
  // about: the phone silently stopped being able to navigate while desktop
  // and prod kept working. Both subnets are listed so moving between them
  // doesn't break again.
  // Ports differ by how the server was started: 3000 via .claude/launch.json,
  // 4000 when run by hand.
  allowedDevOrigins: ['192.168.68.*', '172.26.*.*'],
  experimental: {
    serverActions: {
      allowedOrigins: [
        '192.168.68.*:3000',
        '192.168.68.*:4000',
        '172.26.*.*:3000',
        '172.26.*.*:4000',
      ],
    },
  },
};

export default nextConfig;
