export default function Footer() {
  return (
    <footer className="py-12 px-6 sm:px-8 lg:px-12 border-t border-surface-border">
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-sm text-muted">
          <a
            href="https://github.com/TickTockBent/charlotte"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            GitHub
          </a>
          <span className="text-surface-border">|</span>
          <a
            href="https://www.npmjs.com/package/charlotte-web"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            npm
          </a>
          <span className="text-surface-border">|</span>
          <a
            href="https://github.com/TickTockBent/charlotte/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            MIT License
          </a>
        </div>
        <p className="text-sm text-muted">
          Built with Charlotte.
        </p>
      </div>
    </footer>
  );
}
