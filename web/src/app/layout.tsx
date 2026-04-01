import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "daemons",
  description: "One AI agent. Every device. Yours.",
  icons: {
    icon: "/favicon.png",
    apple: "/app-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <head>
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
