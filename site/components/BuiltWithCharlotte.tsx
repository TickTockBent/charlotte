export default function BuiltWithCharlotte() {
  return (
    <section className="py-20 px-6 sm:px-8 lg:px-12 border-t border-surface-border" data-asm-role="supplementary" data-asm-summary="Charlotte is part of this site's own review loop: dev_serve, observe, and dev_audit are used to check the rendered page, including real accessibility and layout bugs it has caught. Also carries this site's Agent-Readiness Assessment badge, linking to the full scan result." data-asm-priority="low">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold tracking-tight mb-6">
          Charlotte reviews this site.
        </h2>
        <div className="space-y-4 text-muted leading-relaxed">
          <p>
            This site uses Charlotte to check itself. An agent serves it
            locally with{" "}
            <code className="font-mono text-accent text-sm">dev_serve</code>,
            inspects the rendered page with{" "}
            <code className="font-mono text-accent text-sm">observe</code>,
            and runs{" "}
            <code className="font-mono text-accent text-sm">dev_audit</code>{" "}
            for accessibility, SEO, and contrast — switching to a mobile
            viewport and reading element bounding boxes to catch what a skim
            would miss.
          </p>
          <p>
            That loop has caught real bugs: 16 unlabeled SVG icons invisible
            to sighted reviewers but broken for screen readers, and a
            204-pixel horizontal overflow on mobile. Both were fixed in the
            session they were introduced.
          </p>
          <p className="text-foreground font-medium">
            That&apos;s what it means to make the web readable.
          </p>
        </div>

        <div className="mt-8 pt-6 border-t border-surface-border flex flex-wrap items-center gap-x-4 gap-y-3">
          <a
            href="https://www.clocktowerassoc.com/scan/result/msoxxpxn-d29x2r"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded opacity-90 hover:opacity-100 transition-opacity"
            data-asm-action="navigate"
            data-asm-intent="view-agent-readiness-scan"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://www.clocktowerassoc.com/api/badge/scan/msoxxpxn-d29x2r"
              alt="Agent-Readiness Assessment: this site scored Strong. Opens the full scan result."
              width={207}
              height={28}
              className="h-7 w-auto"
            />
          </a>
          <span className="text-sm text-muted">
            This site is scanned for agent readiness too — 14 of 14 discovery
            and manifest checks passing.
          </span>
        </div>
      </div>
    </section>
  );
}
