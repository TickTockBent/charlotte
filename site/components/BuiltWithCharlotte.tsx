export default function BuiltWithCharlotte() {
  return (
    <section className="py-20 px-6 sm:px-8 lg:px-12 border-t border-surface-border" data-asm-role="supplementary" data-asm-summary="Charlotte is part of this site's own review loop: dev_serve, observe, and dev_audit are used to check the rendered page, including real accessibility and layout bugs it has caught." data-asm-priority="low">
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
      </div>
    </section>
  );
}
