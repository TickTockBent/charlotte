import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import { logger } from "../utils/logger.js";

export interface ScreenshotArtifact {
  id: string;
  filename: string;
  path: string;
  format: "png" | "jpeg" | "webp";
  mimeType: string;
  size: number;
  selector?: string;
  url: string;
  title: string;
  timestamp: string;
}

/** Metadata written alongside each screenshot for cross-session persistence. */
interface ArtifactMeta {
  id: string;
  format: "png" | "jpeg" | "webp";
  selector?: string;
  url: string;
  title: string;
  timestamp: string;
}

const INDEX_FILE = ".charlotte-screenshots.json";

/**
 * Manages persistent screenshot artifacts on disk.
 * Screenshots are stored as image files with a companion JSON index
 * for metadata that survives across sessions.
 */
export class ArtifactStore {
  private artifacts = new Map<string, ScreenshotArtifact>();
  private _screenshotDir: string;

  constructor(screenshotDir?: string) {
    this._screenshotDir =
      screenshotDir ?? path.join(os.tmpdir(), "charlotte-screenshots");
  }

  get screenshotDir(): string {
    return this._screenshotDir;
  }

  /** Create the storage directory and load any existing index. */
  async initialize(): Promise<void> {
    await fs.mkdir(this._screenshotDir, { recursive: true });
    await this.loadIndex();
    logger.info("Artifact store initialized", { dir: this._screenshotDir });
  }

  /**
   * Update the screenshot directory at runtime.
   * Initializes the new directory without moving existing files.
   */
  async setScreenshotDir(dir: string): Promise<void> {
    this._screenshotDir = dir;
    this.artifacts.clear();
    await this.initialize();
  }

  /** Save a screenshot to disk and track it. */
  async save(
    data: Buffer,
    metadata: {
      format: "png" | "jpeg" | "webp";
      selector?: string;
      url: string;
      title: string;
    },
  ): Promise<ScreenshotArtifact> {
    const id = this.generateId();
    const ext = metadata.format === "jpeg" ? "jpg" : metadata.format;
    const filename = `${id}.${ext}`;
    const filePath = path.join(this._screenshotDir, filename);

    await fs.writeFile(filePath, data);

    const artifact: ScreenshotArtifact = {
      id,
      filename,
      path: filePath,
      format: metadata.format,
      mimeType: `image/${metadata.format}`,
      size: data.length,
      selector: metadata.selector,
      url: metadata.url,
      title: metadata.title,
      timestamp: new Date().toISOString(),
    };

    this.artifacts.set(id, artifact);
    await this.saveIndex();

    logger.info("Screenshot saved", { id, filename, size: data.length });
    return artifact;
  }

  /** List all tracked artifacts, newest first. */
  list(): ScreenshotArtifact[] {
    return Array.from(this.artifacts.values()).sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  /** Get artifact metadata by ID. */
  get(id: string): ScreenshotArtifact | undefined {
    return this.artifacts.get(id);
  }

  /** Read the raw file bytes for an artifact. */
  async readFile(id: string): Promise<Buffer | null> {
    const artifact = this.artifacts.get(id);
    if (!artifact) return null;
    try {
      return await fs.readFile(artifact.path);
    } catch {
      // File may have been deleted externally
      this.artifacts.delete(id);
      await this.saveIndex();
      return null;
    }
  }

  /** Delete a screenshot artifact from disk and the index. */
  async delete(id: string): Promise<boolean> {
    const artifact = this.artifacts.get(id);
    if (!artifact) return false;

    try {
      await fs.unlink(artifact.path);
    } catch {
      // File already gone — still clean up index
    }

    this.artifacts.delete(id);
    await this.saveIndex();
    logger.info("Screenshot deleted", { id });
    return true;
  }

  /** Number of tracked artifacts. */
  get count(): number {
    return this.artifacts.size;
  }

  // ── Private helpers ──

  private generateId(): string {
    const now = new Date();
    const datePart = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const rand = crypto.randomBytes(3).toString("hex");
    return `ss-${datePart}-${rand}`;
  }

  private get indexPath(): string {
    return path.join(this._screenshotDir, INDEX_FILE);
  }

  private async loadIndex(): Promise<void> {
    try {
      const raw = await fs.readFile(this.indexPath, "utf-8");
      const entries: ArtifactMeta[] = JSON.parse(raw);

      for (const meta of entries) {
        const ext = meta.format === "jpeg" ? "jpg" : meta.format;
        const filename = `${meta.id}.${ext}`;
        const filePath = path.join(this._screenshotDir, filename);

        // Verify the file still exists
        try {
          const stat = await fs.stat(filePath);
          this.artifacts.set(meta.id, {
            id: meta.id,
            filename,
            path: filePath,
            format: meta.format,
            mimeType: `image/${meta.format}`,
            size: stat.size,
            selector: meta.selector,
            url: meta.url,
            title: meta.title,
            timestamp: meta.timestamp,
          });
        } catch {
          // File missing — skip
        }
      }

      logger.info("Loaded artifact index", { count: this.artifacts.size });
    } catch {
      // No index yet — fresh start
    }
  }

  private async saveIndex(): Promise<void> {
    const entries: ArtifactMeta[] = Array.from(this.artifacts.values()).map(
      (a) => ({
        id: a.id,
        format: a.format,
        selector: a.selector,
        url: a.url,
        title: a.title,
        timestamp: a.timestamp,
      }),
    );

    await fs.writeFile(this.indexPath, JSON.stringify(entries, null, 2));
  }
}
