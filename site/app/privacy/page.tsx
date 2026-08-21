import type { Metadata } from "next";
import Link from "next/link";
import Footer from "../../components/Footer";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Privacy notice for the Charlotte website: no personal data is collected from visitors.",
  alternates: {
    canonical: "https://charlotte-rose.vercel.app/privacy",
  },
};

export default function PrivacyPage() {
  return (
    <div
      className="min-h-screen bg-background"
      data-asm-page-type="documentation"
      data-asm-page-purpose="Explain what data the Charlotte website does and does not collect from visitors."
    >
      {/* Nav */}
      <header>
        <nav
          aria-label="Site navigation"
          className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-sm border-b border-surface-border"
        >
          <div className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-12 h-14 flex items-center justify-between">
            <Link href="/" className="font-mono font-bold text-foreground">
              charlotte
            </Link>
            <div className="flex items-center gap-6 text-sm text-muted">
              <Link href="/" className="hover:text-foreground transition-colors">
                Home
              </Link>
              <Link href="/changelog" className="hover:text-foreground transition-colors">
                Changelog
              </Link>
            </div>
          </div>
        </nav>
      </header>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-12 pt-28 pb-20">
        <nav aria-label="Breadcrumb" className="text-sm text-muted mb-6">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-foreground transition-colors">
                Home
              </Link>
            </li>
            <li aria-hidden="true" className="text-surface-border">/</li>
            <li aria-current="page" className="text-foreground">Privacy</li>
          </ol>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-bold mb-2">Privacy</h1>
        <p className="text-muted mb-12">Last updated 2026-08-21.</p>

        <div className="max-w-2xl space-y-10 text-sm text-foreground/90 leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">The short version</h2>
            <p>
              This website does not collect personal data from visitors. There are no accounts,
              no forms, no cookies, and no advertising or tracking pixels.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Traffic analytics</h2>
            <p>
              To understand roughly how many people visit and which pages they read, this site
              uses{" "}
              <a
                href="https://vercel.com/docs/analytics/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Vercel Web Analytics
              </a>
              . It is cookieless and records only aggregate, anonymized information such as page
              views, referrer, country, browser, and device type. It does not use cookies, does
              not store IP addresses, does not fingerprint visitors, and does not track anyone
              across other websites. Nothing collected can be used to identify you.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Hosting</h2>
            <p>
              The site is hosted on Vercel. Like any web host, Vercel&apos;s servers may process
              standard request metadata (such as your IP address) transiently in order to deliver
              pages. We do not access, retain, or analyze that information.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Third-party sharing</h2>
            <p>
              We do not sell, share, or transfer any visitor data to third parties. Links to
              GitHub, npm, and the documentation site lead to services with their own privacy
              policies.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">The Charlotte software</h2>
            <p>
              This notice covers only this website. The Charlotte MCP server runs entirely on
              your own machine or infrastructure and sends no data back to us. See the{" "}
              <a
                href="https://charlotte.mintlify.site/security"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                security documentation
              </a>{" "}
              for details on how it handles the pages it browses.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Questions</h2>
            <p>
              Open an issue on{" "}
              <a
                href="https://github.com/TickTockBent/charlotte/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                GitHub
              </a>
              .
            </p>
          </section>
        </div>
      </main>

      <Footer />
    </div>
  );
}
