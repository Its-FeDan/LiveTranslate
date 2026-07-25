import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "Relay — Russian, understood",
  description:
    "Low-latency Russian to English speech translation with speaker-aware captions.",
  applicationName: "Relay",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Relay",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0b0e0d",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
