import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt =
  "Charlotte vs Playwright MCP — Head-to-head benchmark comparison with real data.";

export default function OgImage() {
  const benchmarks = [
    { site: "Wikipedia", factor: "51x", chars: "22.1K vs 1.14M" },
    { site: "Hacker News", factor: "139x", chars: "364 vs 50.7K" },
    { site: "GitHub", factor: "10x", chars: "3.8K vs 39K" },
    { site: "LinkedIn*", factor: "7.3x", chars: "3.4K vs 25K" },
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 80px",
          background: "#0a0a0a",
          fontFamily: "monospace",
        }}
      >
        {/* Top accent line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "4px",
            background: "#06b6d4",
          }}
        />

        {/* Title */}
        <div
          style={{
            fontSize: "52px",
            fontWeight: 700,
            color: "#e5e5e5",
            marginBottom: "12px",
            letterSpacing: "-1px",
          }}
        >
          Charlotte vs Playwright MCP
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: "24px",
            color: "#06b6d4",
            marginBottom: "48px",
          }}
        >
          Real benchmarks. Real numbers.
        </div>

        {/* Benchmark rows */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          {benchmarks.map((benchmark) => (
            <div
              key={benchmark.site}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "24px",
              }}
            >
              <span
                style={{
                  fontSize: "20px",
                  color: "#a3a3a3",
                  width: "160px",
                }}
              >
                {benchmark.site}
              </span>
              <span
                style={{
                  fontSize: "28px",
                  fontWeight: 700,
                  color: "#06b6d4",
                  width: "110px",
                }}
              >
                {benchmark.factor}
              </span>
              <span style={{ fontSize: "18px", color: "#525252" }}>
                {benchmark.chars}
              </span>
            </div>
          ))}
        </div>

        {/* Footnote */}
        <div
          style={{
            fontSize: "14px",
            color: "#525252",
            marginTop: "16px",
          }}
        >
          *LinkedIn measured on an earlier version
        </div>

        {/* Bottom branding */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            left: "80px",
            display: "flex",
            alignItems: "baseline",
            gap: "12px",
          }}
        >
          <span
            style={{ fontSize: "22px", fontWeight: 700, color: "#e5e5e5" }}
          >
            charlotte
          </span>
          <span style={{ fontSize: "16px", color: "#525252" }}>
            charlotte-rose.vercel.app
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
