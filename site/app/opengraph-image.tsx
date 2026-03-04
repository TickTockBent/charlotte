import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const dynamic = "force-static";
export const contentType = "image/png";
export const size = { width: 1200, height: 630 };
export const alt =
  "Charlotte — Token-efficient MCP server for AI agent web browsing. 136x smaller responses than Playwright MCP.";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
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

        {/* Logo / name */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <span
            style={{
              fontSize: "72px",
              fontWeight: 700,
              color: "#e5e5e5",
              letterSpacing: "-2px",
            }}
          >
            charlotte
          </span>
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: "36px",
            color: "#06b6d4",
            marginBottom: "48px",
            fontWeight: 600,
          }}
        >
          The Web, Readable.
        </div>

        {/* Description */}
        <div
          style={{
            fontSize: "24px",
            color: "#a3a3a3",
            lineHeight: 1.5,
            maxWidth: "900px",
            marginBottom: "48px",
          }}
        >
          MCP server for AI agents. Renders web pages into structured
          representations using headless Chromium.
        </div>

        {/* Stats row */}
        <div
          style={{
            display: "flex",
            gap: "48px",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span
              style={{ fontSize: "40px", fontWeight: 700, color: "#06b6d4" }}
            >
              136x
            </span>
            <span style={{ fontSize: "20px", color: "#737373" }}>
              smaller than Playwright
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span
              style={{ fontSize: "40px", fontWeight: 700, color: "#06b6d4" }}
            >
              40
            </span>
            <span style={{ fontSize: "20px", color: "#737373" }}>tools</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span
              style={{ fontSize: "40px", fontWeight: 700, color: "#06b6d4" }}
            >
              3
            </span>
            <span style={{ fontSize: "20px", color: "#737373" }}>
              detail levels
            </span>
          </div>
        </div>

        {/* Bottom URL */}
        <div
          style={{
            position: "absolute",
            bottom: "40px",
            right: "80px",
            fontSize: "18px",
            color: "#525252",
          }}
        >
          charlotte-rose.vercel.app
        </div>
      </div>
    ),
    { ...size },
  );
}
