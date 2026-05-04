import type { Metadata } from "next";
import { Cinzel, Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { NavLoadingOverlay } from "@/components/NavLoadingOverlay";
import { WowheadRefresh } from "@/components/WowheadRefresh";

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Lessons in Brutality — Skullcrusher",
    template: "%s — Lessons in Brutality",
  },
  description:
    "Lessons in Brutality, a World of Warcraft guild on Skullcrusher. Mythic/Heroic raiding, M+, and community.",
  keywords: [
    "Lessons in Brutality",
    "LIB",
    "Skullcrusher",
    "World of Warcraft",
    "WoW guild",
    "raiding",
    "Mythic+",
    "Alliance",
    "US",
  ],
  applicationName: "Lessons in Brutality",
  authors: [{ name: "Lessons in Brutality" }],
  icons: {
    icon: "/LIB_Logo.png",
    apple: "/LIB_Logo.png",
    shortcut: "/LIB_Logo.png",
  },
  openGraph: {
    type: "website",
    siteName: "Lessons in Brutality",
    title: "Lessons in Brutality — Skullcrusher",
    description:
      "A Mythic/Heroic-progression raiding guild on Skullcrusher (US-Alliance). Active raid team plus Mythic+.",
    locale: "en_US",
    // Image is generated dynamically by app/opengraph-image.tsx — current
    // tier progression overlaid on the LIB logo. Same file feeds twitter:image
    // via app/twitter-image.tsx.
  },
  twitter: {
    card: "summary_large_image",
    title: "Lessons in Brutality — Skullcrusher",
    description:
      "A Mythic/Heroic-progression raiding guild on Skullcrusher (US-Alliance). Active raid team plus Mythic+.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-faction="alliance"
      className={`${cinzel.variable} ${inter.variable} h-full antialiased`}
    >
      <head>
        {/* Image CDNs — start TLS handshake before first <img> request fires.
            Cuts ~100–300ms off first-image paint, especially on mobile. */}
        <link
          rel="preconnect"
          href="https://render.worldofwarcraft.com"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://wow.zamimg.com"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://cdn.raiderio.net"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <NavLoadingOverlay />
        <WowheadRefresh />
        <Script
          src="https://wow.zamimg.com/widgets/power.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
