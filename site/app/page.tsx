import Hero from "../components/Hero";
import Benchmarks from "../components/Benchmarks";
import OutputDemo from "../components/OutputDemo";
import ToolGrid from "../components/ToolGrid";
import UsageExamples from "../components/UsageExamples";
import QuickStart from "../components/QuickStart";
import BuiltWithCharlotte from "../components/BuiltWithCharlotte";
import Footer from "../components/Footer";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-sm border-b border-surface-border">
        <div className="max-w-5xl mx-auto px-6 sm:px-8 lg:px-12 h-14 flex items-center justify-between">
          <a href="#" className="font-mono font-bold text-foreground">
            charlotte
          </a>
          <div className="hidden sm:flex items-center gap-6 text-sm text-muted">
            <a href="#benchmarks" className="hover:text-foreground transition-colors">
              Benchmarks
            </a>
            <a href="#output" className="hover:text-foreground transition-colors">
              Output
            </a>
            <a href="#tools" className="hover:text-foreground transition-colors">
              Tools
            </a>
            <a href="#examples" className="hover:text-foreground transition-colors">
              Examples
            </a>
            <a href="#quickstart" className="hover:text-foreground transition-colors">
              Quick Start
            </a>
          </div>
          <a
            href="https://github.com/TickTockBent/charlotte"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-foreground transition-colors"
            aria-label="GitHub repository"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </a>
        </div>
      </nav>

      {/* Main content */}
      <main>
        <Hero />
        <Benchmarks />
        <OutputDemo />
        <ToolGrid />
        <UsageExamples />
        <QuickStart />
        <BuiltWithCharlotte />
      </main>

      <Footer />
    </div>
  );
}
