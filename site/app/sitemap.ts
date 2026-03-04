import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://charlotte-rose.vercel.app";

  return [
    {
      url: `${baseUrl}/`,
      lastModified: new Date("2026-03-04"),
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
      lastModified: new Date("2026-03-04"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];
}
