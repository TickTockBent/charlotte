import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://charlotte-rose.vercel.app"),
  title: {
    default: "Charlotte — The Web, Readable",
    template: "%s | Charlotte",
  },
  description:
    "MCP server that renders web pages into structured, agent-readable representations using headless Chromium. 40 tools for navigation, observation, and interaction — 25-182x more token-efficient than Playwright MCP.",
  keywords: [
    "MCP",
    "Model Context Protocol",
    "web automation",
    "headless browser",
    "AI agent",
    "accessibility tree",
    "Puppeteer",
    "Charlotte",
    "browser MCP",
    "playwright mcp alternative",
    "token efficient browser",
  ],
  openGraph: {
    title: "Charlotte — The Web, Readable",
    description:
      "MCP server that renders web pages into structured, agent-readable representations. 40 tools for AI agents to navigate, observe, and interact with the web.",
    type: "website",
    url: "https://charlotte-rose.vercel.app",
    siteName: "Charlotte",
  },
  twitter: {
    card: "summary_large_image",
    title: "Charlotte — The Web, Readable",
    description:
      "MCP server that renders web pages into structured, agent-readable representations. 40 tools for AI agents.",
  },
  alternates: {
    canonical: "https://charlotte-rose.vercel.app",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="axiom-manifest" type="application/json" href="/axiom.json" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "Charlotte",
              applicationCategory: "DeveloperApplication",
              operatingSystem: "Cross-platform",
              description:
                "MCP server that renders web pages into structured, agent-readable representations using headless Chromium.",
              url: "https://charlotte-rose.vercel.app",
              downloadUrl:
                "https://www.npmjs.com/package/@ticktockbent/charlotte",
              license: "https://opensource.org/licenses/MIT",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              sourceOrganization: {
                "@type": "Organization",
                name: "Charlotte",
                url: "https://github.com/TickTockBent/charlotte",
              },
            }),
          }}
        />
        {children}
      </body>
    </html>
  );
}
