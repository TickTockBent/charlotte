import CopyButton from "./CopyButton";

interface CodeBlockProps {
  code: string;
  language?: string;
  showCopy?: boolean;
}

export default function CodeBlock({
  code,
  language = "json",
  showCopy = true,
}: CodeBlockProps) {
  return (
    <div className="relative group rounded-lg border border-surface-border bg-surface overflow-hidden">
      {language && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-surface-border">
          <span className="text-xs font-mono text-muted">{language}</span>
          {showCopy && <CopyButton text={code} />}
        </div>
      )}
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
        <code className="font-mono text-foreground/90">{code}</code>
      </pre>
    </div>
  );
}
