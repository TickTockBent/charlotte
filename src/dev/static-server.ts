import express from "express";
import type { Request, Response, NextFunction } from "express";
import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import { logger } from "../utils/logger.js";

export interface StaticServerOptions {
  allowedRoot?: string;
  directoryPath: string;
  port?: number;
}

export interface StaticServerInfo {
  url: string;
  port: number;
  directoryPath: string;
}

export class StaticServer {
  private httpServer: http.Server | null = null;
  private serverInfo: StaticServerInfo | null = null;

  async start(options: StaticServerOptions): Promise<StaticServerInfo> {
    // Stop any existing server first
    if (this.httpServer) {
      await this.stop();
    }

    const resolvedDirPath = path.resolve(options.directoryPath);
    const absoluteDirectoryPath = fs.existsSync(resolvedDirPath)
      ? fs.realpathSync(resolvedDirPath)
      : resolvedDirPath;

    const configuredRoot = options.allowedRoot ? path.resolve(options.allowedRoot) : process.cwd();
    const rootPath = fs.existsSync(configuredRoot)
      ? fs.realpathSync(configuredRoot)
      : configuredRoot;

    // Use separator-anchored prefix check to prevent `/home/user/project-secrets` matching
    // a root of `/home/user/project` (mirrors the pattern in tool-helpers.ts:resolveOutputPath).
    if (
      !absoluteDirectoryPath.startsWith(rootPath + path.sep) &&
      absoluteDirectoryPath !== rootPath
    ) {
      throw new Error(`Directory traversal blocked. Path must be within ${rootPath}`);
    }

    const app = express();

    // Deny dot-file requests (e.g. GET /.git/config) before static middleware.
    app.use((req: Request, res: Response, next: NextFunction) => {
      const decodedUrl = decodeURIComponent(req.path);
      if (decodedUrl.split("/").some((segment) => segment.startsWith("."))) {
        res.status(403).send("Forbidden");
        return;
      }
      next();
    });

    // Realpath-containment middleware: after express resolves the file, verify
    // the real path stays inside absoluteDirectoryPath (catches symlink escapes).
    app.use(async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Build the candidate filesystem path from the URL
        const candidatePath = path.join(absoluteDirectoryPath, decodeURIComponent(req.path));
        // Only check if the file exists (let express.static handle 404)
        try {
          const realCandidatePath = await fsPromises.realpath(candidatePath);
          const realServedRoot = await fsPromises.realpath(absoluteDirectoryPath);
          if (
            !realCandidatePath.startsWith(realServedRoot + path.sep) &&
            realCandidatePath !== realServedRoot
          ) {
            res.status(403).send("Forbidden");
            return;
          }
        } catch {
          // File does not exist — let express.static return 404
        }
        next();
      } catch {
        next();
      }
    });

    // dotfiles: "deny" prevents express.static from serving hidden files as a second line
    // of defence (the middleware above catches them earlier for cleaner 403 responses).
    app.use(express.static(absoluteDirectoryPath, { dotfiles: "deny" }));

    const listenPort = options.port ?? 0;

    return new Promise<StaticServerInfo>((resolve, reject) => {
      const server = app.listen(listenPort, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to get server address"));
          return;
        }

        const assignedPort = address.port;
        const info: StaticServerInfo = {
          // Bind and report using 127.0.0.1 explicitly: on hosts where `localhost` resolves to
          // ::1 first, headless Chromium (IPv4-only) would fail to connect via the hostname.
          url: `http://127.0.0.1:${assignedPort}`,
          port: assignedPort,
          directoryPath: absoluteDirectoryPath,
        };

        this.httpServer = server;
        this.serverInfo = info;
        logger.info("Static server started", {
          url: info.url,
          directory: info.directoryPath,
        });
        resolve(info);
      });

      server.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") {
          reject(new Error(`Port ${listenPort} is already in use`));
        } else {
          reject(error);
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.httpServer!.close((error) => {
        if (error) {
          logger.warn("Error closing static server", error);
          reject(error);
        } else {
          logger.info("Static server stopped");
          resolve();
        }
        this.httpServer = null;
        this.serverInfo = null;
      });
    });
  }

  isRunning(): boolean {
    return this.httpServer !== null;
  }

  getInfo(): StaticServerInfo | null {
    return this.serverInfo;
  }
}
