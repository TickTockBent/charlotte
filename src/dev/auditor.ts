import type { Page, CDPSession } from "puppeteer";
import { logger } from "../utils/logger.js";

export type AuditCategory =
  | "a11y"
  | "performance"
  | "seo"
  | "contrast"
  | "links";

export interface AuditFinding {
  category: AuditCategory;
  severity: "error" | "warning" | "info";
  message: string;
  element?: string;
  recommendation: string;
}

export interface AuditResult {
  categories_checked: AuditCategory[];
  findings: AuditFinding[];
  summary: string;
}

const ALL_CATEGORIES: AuditCategory[] = [
  "a11y",
  "performance",
  "seo",
  "contrast",
  "links",
];

/**
 * Compute relative luminance of a color per WCAG 2.1.
 * Input: r, g, b in 0-255 range.
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Compute WCAG 2.1 contrast ratio between two colors.
 * Returns a ratio >= 1.
 */
export function contrastRatio(
  foregroundRgb: [number, number, number],
  backgroundRgb: [number, number, number],
): number {
  const luminanceForeground = relativeLuminance(...foregroundRgb);
  const luminanceBackground = relativeLuminance(...backgroundRgb);
  const lighter = Math.max(luminanceForeground, luminanceBackground);
  const darker = Math.min(luminanceForeground, luminanceBackground);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Parse a CSS color string like "rgb(255, 0, 0)" or "rgba(255, 0, 0, 1)" to [r, g, b].
 * Returns null if unparseable.
 */
export function parseRgbColor(
  colorString: string,
): [number, number, number] | null {
  const rgbMatch = colorString.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
  );
  if (rgbMatch) {
    return [
      parseInt(rgbMatch[1], 10),
      parseInt(rgbMatch[2], 10),
      parseInt(rgbMatch[3], 10),
    ];
  }
  return null;
}

function buildSummary(findings: AuditFinding[]): string {
  if (findings.length === 0) {
    return "No issues found.";
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const infoCount = findings.filter((f) => f.severity === "info").length;

  const parts: string[] = [];
  if (errorCount > 0) parts.push(`${errorCount} error${errorCount > 1 ? "s" : ""}`);
  if (warningCount > 0) parts.push(`${warningCount} warning${warningCount > 1 ? "s" : ""}`);
  if (infoCount > 0) parts.push(`${infoCount} info`);

  return `${findings.length} finding${findings.length > 1 ? "s" : ""}: ${parts.join(", ")}`;
}

export class Auditor {
  async audit(
    page: Page,
    session: CDPSession,
    categories?: AuditCategory[],
  ): Promise<AuditResult> {
    const categoriesToCheck = categories && categories.length > 0
      ? categories
      : ALL_CATEGORIES;

    const allFindings: AuditFinding[] = [];

    for (const category of categoriesToCheck) {
      try {
        const categoryFindings = await this.runCategoryAudit(
          category,
          page,
          session,
        );
        allFindings.push(...categoryFindings);
      } catch (error: unknown) {
        logger.warn(`Audit category '${category}' failed`, error);
        allFindings.push({
          category,
          severity: "warning",
          message: `Audit check failed: ${error instanceof Error ? error.message : String(error)}`,
          recommendation: "Check console for details and retry.",
        });
      }
    }

    return {
      categories_checked: categoriesToCheck,
      findings: allFindings,
      summary: buildSummary(allFindings),
    };
  }

  private async runCategoryAudit(
    category: AuditCategory,
    page: Page,
    session: CDPSession,
  ): Promise<AuditFinding[]> {
    switch (category) {
      case "a11y":
        return this.auditAccessibility(session);
      case "performance":
        return this.auditPerformance(session);
      case "seo":
        return this.auditSeo(page);
      case "contrast":
        return this.auditContrast(page, session);
      case "links":
        return this.auditLinks(page);
    }
  }

  private async auditAccessibility(
    session: CDPSession,
  ): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];

    const { nodes } = await session.send("Accessibility.getFullAXTree");

    const headingLevels: number[] = [];

    for (const node of nodes) {
      const role = node.role?.value as string | undefined;
      const name = node.name?.value as string | undefined;
      const nameIsEmpty = !name || name.trim() === "";

      // Images without alt text (AX role is "image", not "img")
      if ((role === "image" || role === "img") && nameIsEmpty) {
        findings.push({
          category: "a11y",
          severity: "error",
          message: "Image has no accessible name (missing alt text).",
          element: `backendNodeId:${node.backendDOMNodeId}`,
          recommendation:
            "Add an alt attribute describing the image, or alt=\"\" for decorative images.",
        });
      }

      // Buttons without labels
      if (role === "button" && nameIsEmpty) {
        findings.push({
          category: "a11y",
          severity: "error",
          message: "Button has no accessible name.",
          element: `backendNodeId:${node.backendDOMNodeId}`,
          recommendation:
            "Add text content, aria-label, or aria-labelledby to the button.",
        });
      }

      // Links without labels
      if (role === "link" && nameIsEmpty) {
        findings.push({
          category: "a11y",
          severity: "error",
          message: "Link has no accessible name.",
          element: `backendNodeId:${node.backendDOMNodeId}`,
          recommendation:
            "Add text content, aria-label, or aria-labelledby to the link.",
        });
      }

      // Form inputs without labels
      if (
        (role === "textbox" ||
          role === "combobox" ||
          role === "checkbox" ||
          role === "radio" ||
          role === "spinbutton" ||
          role === "slider") &&
        nameIsEmpty
      ) {
        findings.push({
          category: "a11y",
          severity: "error",
          message: `Form input (${role}) has no accessible name.`,
          element: `backendNodeId:${node.backendDOMNodeId}`,
          recommendation:
            "Add a <label> element, aria-label, or aria-labelledby.",
        });
      }

      // Track heading levels for hierarchy check
      if (role === "heading") {
        const level = node.properties?.find(
          (p: { name: string }) => p.name === "level",
        )?.value?.value;
        if (typeof level === "number") {
          headingLevels.push(level);
        }
      }
    }

    // Check heading hierarchy
    for (let i = 1; i < headingLevels.length; i++) {
      const previousLevel = headingLevels[i - 1];
      const currentLevel = headingLevels[i];
      if (currentLevel > previousLevel + 1) {
        findings.push({
          category: "a11y",
          severity: "warning",
          message: `Heading level skipped: h${previousLevel} followed by h${currentLevel}.`,
          recommendation: `Use sequential heading levels (h${previousLevel} → h${previousLevel + 1}).`,
        });
      }
    }

    return findings;
  }

  private async auditPerformance(
    session: CDPSession,
  ): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];

    await session.send("Performance.enable");
    const { metrics } = await session.send("Performance.getMetrics");
    await session.send("Performance.disable");

    const metricMap = new Map<string, number>();
    for (const metric of metrics) {
      metricMap.set(metric.name, metric.value);
    }

    // DOM node count
    const domNodeCount = metricMap.get("Nodes");
    if (domNodeCount !== undefined) {
      if (domNodeCount > 3000) {
        findings.push({
          category: "performance",
          severity: "error",
          message: `DOM has ${domNodeCount} nodes (exceeds 3000).`,
          recommendation:
            "Reduce DOM complexity by removing unnecessary elements or using virtualization.",
        });
      } else if (domNodeCount > 1500) {
        findings.push({
          category: "performance",
          severity: "warning",
          message: `DOM has ${domNodeCount} nodes (exceeds 1500).`,
          recommendation:
            "Consider simplifying the DOM structure for better performance.",
        });
      }
    }

    // Heap usage
    const heapUsed = metricMap.get("JSHeapUsedSize");
    const heapTotal = metricMap.get("JSHeapTotalSize");
    if (heapUsed !== undefined && heapTotal !== undefined && heapTotal > 0) {
      const heapPercent = (heapUsed / heapTotal) * 100;
      if (heapPercent > 80) {
        findings.push({
          category: "performance",
          severity: "warning",
          message: `JS heap usage is ${heapPercent.toFixed(1)}% (${(heapUsed / 1024 / 1024).toFixed(1)}MB / ${(heapTotal / 1024 / 1024).toFixed(1)}MB).`,
          recommendation:
            "Investigate memory usage and potential memory leaks.",
        });
      }
    }

    // Layout and style recalc counts
    const layoutCount = metricMap.get("LayoutCount");
    const recalcStyleCount = metricMap.get("RecalcStyleCount");
    const scriptDuration = metricMap.get("ScriptDuration");
    const taskDuration = metricMap.get("TaskDuration");

    const performanceStats: string[] = [];
    if (layoutCount !== undefined) performanceStats.push(`layouts: ${layoutCount}`);
    if (recalcStyleCount !== undefined) performanceStats.push(`style recalcs: ${recalcStyleCount}`);
    if (scriptDuration !== undefined) performanceStats.push(`script: ${(scriptDuration * 1000).toFixed(0)}ms`);
    if (taskDuration !== undefined) performanceStats.push(`total tasks: ${(taskDuration * 1000).toFixed(0)}ms`);

    if (performanceStats.length > 0) {
      findings.push({
        category: "performance",
        severity: "info",
        message: `Performance metrics: ${performanceStats.join(", ")}.`,
        recommendation: "Use these metrics as a baseline for performance comparisons.",
      });
    }

    return findings;
  }

  private async auditSeo(page: Page): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];

    const seoData = await page.evaluate(() => {
      const title = document.title;
      const metaDescription = document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content");
      const metaViewport = document
        .querySelector('meta[name="viewport"]')
        ?.getAttribute("content");
      const htmlLang = document.documentElement.getAttribute("lang");
      const h1Elements = document.querySelectorAll("h1");
      const headings = Array.from(
        document.querySelectorAll("h1, h2, h3, h4, h5, h6"),
      ).map((heading) => parseInt(heading.tagName.substring(1), 10));

      return {
        title: title || "",
        metaDescription: metaDescription ?? null,
        metaViewport: metaViewport ?? null,
        htmlLang: htmlLang ?? null,
        h1Count: h1Elements.length,
        headingLevels: headings,
      };
    });

    if (!seoData.title) {
      findings.push({
        category: "seo",
        severity: "error",
        message: "Page has no <title> tag or title is empty.",
        recommendation: "Add a descriptive <title> element in the <head>.",
      });
    }

    if (seoData.metaDescription === null) {
      findings.push({
        category: "seo",
        severity: "warning",
        message: "Page has no <meta name=\"description\"> tag.",
        recommendation:
          "Add a meta description for search engine summaries.",
      });
    } else if (seoData.metaDescription.trim() === "") {
      findings.push({
        category: "seo",
        severity: "warning",
        message: "Meta description is empty.",
        recommendation: "Add meaningful content to the meta description.",
      });
    }

    if (seoData.metaViewport === null) {
      findings.push({
        category: "seo",
        severity: "warning",
        message: "Page has no <meta name=\"viewport\"> tag.",
        recommendation:
          'Add <meta name="viewport" content="width=device-width, initial-scale=1.0">.',
      });
    }

    if (seoData.htmlLang === null) {
      findings.push({
        category: "seo",
        severity: "warning",
        message: "HTML element has no lang attribute.",
        recommendation:
          'Add lang attribute to the <html> element, e.g. <html lang="en">.',
      });
    }

    if (seoData.h1Count === 0) {
      findings.push({
        category: "seo",
        severity: "warning",
        message: "Page has no <h1> element.",
        recommendation: "Add a single <h1> element for the page's main topic.",
      });
    } else if (seoData.h1Count > 1) {
      findings.push({
        category: "seo",
        severity: "warning",
        message: `Page has ${seoData.h1Count} <h1> elements.`,
        recommendation: "Use only one <h1> per page for clarity.",
      });
    }

    // Check heading hierarchy
    for (let i = 1; i < seoData.headingLevels.length; i++) {
      const previousLevel = seoData.headingLevels[i - 1];
      const currentLevel = seoData.headingLevels[i];
      if (currentLevel > previousLevel + 1) {
        findings.push({
          category: "seo",
          severity: "info",
          message: `Heading hierarchy skip: h${previousLevel} → h${currentLevel}.`,
          recommendation: "Use sequential heading levels for better SEO structure.",
        });
        break; // Only report the first skip
      }
    }

    return findings;
  }

  private async auditContrast(
    page: Page,
    session: CDPSession,
  ): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];
    const MAX_TEXT_ELEMENTS_TO_CHECK = 50;

    // Get text elements with their computed styles via page.evaluate
    const textElementData = await page.evaluate(
      (maxElements: number) => {
        const elements: Array<{
          text: string;
          color: string;
          backgroundColor: string;
          fontSize: string;
          fontWeight: string;
          selector: string;
        }> = [];

        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: (node) => {
              const text = node.textContent?.trim();
              if (!text || text.length === 0) return NodeFilter.FILTER_REJECT;
              return NodeFilter.FILTER_ACCEPT;
            },
          },
        );

        let count = 0;
        while (walker.nextNode() && count < maxElements) {
          const textNode = walker.currentNode;
          const parentElement = textNode.parentElement;
          if (!parentElement) continue;

          const computedStyle = window.getComputedStyle(parentElement);
          const color = computedStyle.color;
          const backgroundColor = computedStyle.backgroundColor;

          // Skip transparent backgrounds (they inherit from parent)
          if (
            backgroundColor === "rgba(0, 0, 0, 0)" ||
            backgroundColor === "transparent"
          ) {
            continue;
          }

          elements.push({
            text: (textNode.textContent?.trim() ?? "").substring(0, 50),
            color,
            backgroundColor,
            fontSize: computedStyle.fontSize,
            fontWeight: computedStyle.fontWeight,
            selector: parentElement.tagName.toLowerCase() +
              (parentElement.id ? `#${parentElement.id}` : "") +
              (parentElement.className
                ? `.${parentElement.className.split(" ").join(".")}`
                : ""),
          });
          count++;
        }

        return elements;
      },
      MAX_TEXT_ELEMENTS_TO_CHECK,
    );

    for (const elementData of textElementData) {
      const foregroundRgb = parseRgbColor(elementData.color);
      const backgroundRgb = parseRgbColor(elementData.backgroundColor);

      if (!foregroundRgb || !backgroundRgb) continue;

      const ratio = contrastRatio(foregroundRgb, backgroundRgb);

      // Determine if text is "large" per WCAG
      const fontSizePx = parseFloat(elementData.fontSize);
      const fontWeightNumeric =
        elementData.fontWeight === "bold"
          ? 700
          : parseInt(elementData.fontWeight, 10) || 400;
      const isLargeText =
        fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeightNumeric >= 700);

      const minimumRatio = isLargeText ? 3 : 4.5;

      if (ratio < minimumRatio) {
        findings.push({
          category: "contrast",
          severity: ratio < 3 ? "error" : "warning",
          message: `Low contrast ratio ${ratio.toFixed(2)}:1 (minimum ${minimumRatio}:1 for ${isLargeText ? "large" : "normal"} text). Text: "${elementData.text}".`,
          element: elementData.selector,
          recommendation: `Increase contrast between text color (${elementData.color}) and background (${elementData.backgroundColor}).`,
        });
      }
    }

    return findings;
  }

  private async auditLinks(page: Page): Promise<AuditFinding[]> {
    const findings: AuditFinding[] = [];
    const MAX_LINKS_TO_CHECK = 50;
    const LINK_TIMEOUT_MS = 3000;

    // Collect all link hrefs from the page
    const linkData = await page.evaluate(() => {
      const anchors = document.querySelectorAll("a[href]");
      return Array.from(anchors).map((anchor) => ({
        href: (anchor as HTMLAnchorElement).href,
        text:
          anchor.textContent?.trim().substring(0, 50) || "(no text)",
      }));
    });

    // Filter to checkable links and deduplicate
    const checkedUrls = new Set<string>();
    const linksToCheck: Array<{ href: string; text: string }> = [];

    for (const link of linkData) {
      if (linksToCheck.length >= MAX_LINKS_TO_CHECK) break;

      // Skip non-HTTP links
      if (
        !link.href.startsWith("http://") &&
        !link.href.startsWith("https://")
      ) {
        continue;
      }

      // Skip already-checked URLs
      if (checkedUrls.has(link.href)) continue;
      checkedUrls.add(link.href);

      linksToCheck.push(link);
    }

    // Check all links concurrently
    const checkResults = await Promise.allSettled(
      linksToCheck.map(async (link) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          LINK_TIMEOUT_MS,
        );

        try {
          const response = await fetch(link.href, {
            method: "HEAD",
            signal: controller.signal,
            redirect: "follow",
          });
          return { link, status: response.status, ok: response.ok };
        } catch {
          return { link, status: 0, ok: false, timeout: true };
        } finally {
          clearTimeout(timeoutId);
        }
      }),
    );

    for (const result of checkResults) {
      if (result.status !== "fulfilled") continue;

      const { link, status, ok } = result.value;

      if (!ok && status >= 400) {
        findings.push({
          category: "links",
          severity: status >= 500 ? "error" : "warning",
          message: `Broken link (HTTP ${status}): ${link.href}`,
          element: `"${link.text}"`,
          recommendation: "Fix or remove the broken link.",
        });
      }
    }

    return findings;
  }
}
