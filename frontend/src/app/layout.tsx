import type { Metadata } from "next";
import "@fontsource/inter";
import "@fontsource/space-grotesk";
import "@fontsource/jetbrains-mono";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/providers";

export const metadata: Metadata = {
  title: "BlitzMine — Real-time Mining on Solana",
  description:
    "A provably fair competitive mining game powered by MagicBlock Ephemeral Rollups.",
  icons: {
    icon: "/LOGO/favicon.png",
  },
  other: {
    "ory-verify": "orynth-13495533550f4b33a54177ab6683f1bb",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/@react-grab/cursor/dist/client.global.js"
            strategy="lazyOnload"
          />
        )}
      </head>
      <body className="antialiased font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
