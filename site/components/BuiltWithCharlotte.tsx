export default function BuiltWithCharlotte() {
  return (
    <section className="py-20 px-6 sm:px-8 lg:px-12 border-t border-surface-border">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-2xl font-bold tracking-tight mb-6">
          This page was built by an agent.
        </h2>
        <div className="space-y-4 text-muted leading-relaxed">
          <p>
            An AI agent designed this entire website, wrote every component,
            and shipped it in a single session — with no human reviewing
            screenshots or testing on a phone.
          </p>
          <p>
            It didn&apos;t need to. Charlotte gave it eyes.
          </p>
          <p>
            The agent served the site locally with{" "}
            <code className="font-mono text-accent text-sm">dev_serve</code>,
            inspected the rendered page with{" "}
            <code className="font-mono text-accent text-sm">observe</code>,
            and ran{" "}
            <code className="font-mono text-accent text-sm">dev_audit</code>{" "}
            to check accessibility, SEO, and contrast. It switched to a mobile
            viewport, detected that code blocks were overflowing past the edge
            of the screen by reading element bounding boxes, fixed the CSS, and
            verified the fix — all without a human ever looking at the page.
          </p>
          <p>
            Charlotte caught 16 unlabeled SVG icons that would have been
            invisible to sighted reviewers but broken for screen readers. It
            found a 204-pixel horizontal overflow on mobile that would have
            shipped unnoticed. Both bugs were fixed in the same session they
            were introduced.
          </p>
          <p className="text-foreground font-medium">
            That&apos;s what it means to make the web readable.
          </p>
        </div>
      </div>
    </section>
  );
}
