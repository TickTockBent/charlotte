import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://charlotte-rose.vercel.app";

  return [
    {
      url: `${baseUrl}/`,
      lastModified: new Date("2026-03-09"),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/vs-playwright/`,
      lastModified: new Date("2026-03-04"),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/changelog/`,
      lastModified: new Date("2026-03-09"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    // TODO: Add standalone pages for more search entry points:
    // - /setup/ (getting started guide — maps to docs/mcp-setup.md)
    // - /spec/ (full specification reference — maps to docs/CHARLOTTE_SPEC.md)
    // - /sandbox/ (sandbox walkthrough — maps to docs/sandbox.md)
    // - /benchmarks/ (benchmark methodology — maps to docs/charlotte-benchmark-report.md)
  ];
}
