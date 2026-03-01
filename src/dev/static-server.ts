import express from "express";
import * as http from "node:http";
import * as path from "node:path";
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

    const absoluteDirectoryPath = path.resolve(options.directoryPath);
    const rootPath = options.allowedRoot ? path.resolve(options.allowedRoot) : process.cwd();
    if (!absoluteDirectoryPath.startsWith(rootPath)) {
      throw new Error(`Directory traversal blocked. Path must be within ${rootPath}`);
    }
    if (!absoluteDirectoryPath.startsWith("/home/ncurado/.openclaw/workspace")) {
      throw new Error("Directory traversal blocked");
    }

    const app = express();
    app.use(express.static(absoluteDirectoryPath));

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
          url: `http://localhost:${assignedPort}`,
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
