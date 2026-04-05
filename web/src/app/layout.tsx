import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "daemon — one AI agent, every device, yours",
  description: "A personal AI coding agent that runs across all your devices. Connect your laptop, phone, and server into one AI-powered workspace. Multi-model support, project memory, built-in deployment. Open source.",
  keywords: ["AI coding agent", "multi-device AI", "vibe coding", "Claude Code alternative", "AI development tool", "daemon.page"],
  authors: [{ name: "Arthur Camara" }],
  openGraph: {
    title: "daemon — one AI agent, every device, yours",
    description: "A personal AI coding agent that runs across all your devices. Multi-model, project memory, built-in deployment.",
    url: "https://daemon.page",
    siteName: "daemon",
    type: "website",
    images: [{ url: "https://daemon.page/brand/logo-screen.png", width: 1200, height: 630, alt: "daemon" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "daemon — one AI agent, every device, yours",
    description: "A personal AI coding agent across all your devices.",
    images: ["https://daemon.page/brand/logo-screen.png"],
  },
  metadataBase: new URL("https://daemon.page"),
  robots: { index: true, follow: true },
  icons: {
    icon: "/favicon2.png",
    apple: "/app-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable}`} style={{ height: '100%', minHeight: '-webkit-fill-available' }}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
        <meta name="theme-color" content="#111111" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="apple-touch-icon" href="/app-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <script src="https://accounts.google.com/gsi/client" async defer></script>
      </head>
      <body className="min-h-full bg-[#0a0a0a] text-[#bfbfbf] antialiased font-[family-name:var(--font-geist)]">
        {children}
      </body>
    </html>
  );
}
