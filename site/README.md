# Charlotte marketing site

The public marketing site for [Charlotte](../README.md), built with [Next.js](https://nextjs.org) and statically exported.

## Development

```bash
npm install
npm run dev      # local dev server at http://localhost:3000
```

## Build

```bash
npm run build    # static export to ./out (next.config.ts sets output: "export")
```

The site is a fully static export — `next build` writes the deployable HTML/CSS/JS into `out/`.

## Deployment

This site deploys to Vercel. Deploy configuration lives in [`vercel.json`](vercel.json) in this directory (`site/`), not at the repository root: the Vercel project's **Root Directory** is set to `site/`. `vercel.json` pins `buildCommand: next build` and `outputDirectory: out` to match the static export above.

> Note: there is intentionally no `vercel.json` at the repository root — the root `package.json` builds the MCP server (`tsc` → `dist/`), not this site, so a root deploy config would be incoherent.
