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
  title: "Charlotte — The Web, Readable",
  description:
    "MCP server that renders web pages into structured, agent-readable representations using headless Chromium. 30 tools for navigation, observation, and interaction.",
  keywords: [
    "MCP",
    "Model Context Protocol",
    "web automation",
    "headless browser",
    "AI agent",
    "accessibility tree",
    "Puppeteer",
    "Charlotte",
  ],
  openGraph: {
    title: "Charlotte — The Web, Readable",
    description:
      "MCP server that renders web pages into structured, agent-readable representations. 30 tools for AI agents to navigate, observe, and interact with the web.",
    type: "website",
    url: "https://charlotte-mcp.vercel.app",
  },
  twitter: {
    card: "summary_large_image",
    title: "Charlotte — The Web, Readable",
    description:
      "MCP server that renders web pages into structured, agent-readable representations. 30 tools for AI agents.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
