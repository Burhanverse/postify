import Fastify, {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import mongoose from "mongoose";
import { getAgenda } from "./services/agenda";
import { env } from "./config/env";
import { logger } from "./utils/logger";
import { PostModel } from "./models/Post";
import { ChannelModel } from "./models/Channel";
import { UserModel } from "./models/User";

export function createServer(): FastifyInstance {
  const app = Fastify({ logger: false });

  async function buildStatus() {
    const agenda = getAgenda();
    const dbState = mongoose.connection.readyState; // 0=disconnected,1=connected,2=connecting,3=disconnecting
    let counts = { posts: 0, channels: 0, users: 0 };
    try {
      if (dbState === 1) {
        const [posts, channels, users] = await Promise.all([
          PostModel.countDocuments(),
          ChannelModel.countDocuments(),
          UserModel.countDocuments(),
        ]);
        counts = { posts, channels, users };
      }
    } catch (err) {
      logger.warn({ err }, "Failed to collect counts");
    }
    return {
      status: "ok",
      uptime: process.uptime(),
      pid: process.pid,
      timestamp: new Date().toISOString(),
      db: dbState === 1 ? "connected" : dbState,
      agenda: agenda ? "initialized" : "not_initialized",
      botStarted: !/ABCDEF|YOUR_TOKEN|123456:ABC/i.test(env.BOT_TOKEN),
      counts,
      version: process.env.npm_package_version,
      port: env.PORT,
    };
  }

  interface StatusInfo {
    status: string;
    uptime: number;
    pid: number;
    timestamp: string;
    db: string | number;
    agenda: string;
    botStarted: boolean;
    counts: { posts: number; channels: number; users: number };
    version?: string;
    port: number;
  }

  const renderDocs = (status: StatusInfo) => `<!doctype html>
<html lang=en>
<meta charset=utf-8 />
<title>Postify Bot Overview</title>
<style>body{font-family:system-ui,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 1rem;line-height:1.4}code{background:#f5f5f5;padding:2px 4px;border-radius:4px}pre{background:#f5f5f5;padding:1rem;border-radius:6px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}</style>
<h1>Postify Bot</h1>
<p>Telegram channel management & scheduling bot. This endpoint combines documentation & runtime status.</p>
<h2>Runtime Status</h2>
<table>
 <tr><th>Field</th><th>Value</th></tr>
 <tr><td>Status</td><td>${status.status}</td></tr>
 <tr><td>DB</td><td>${status.db}</td></tr>
 <tr><td>Agenda</td><td>${status.agenda}</td></tr>
 <tr><td>Bot Started</td><td>${status.botStarted}</td></tr>
 <tr><td>Uptime (s)</td><td>${status.uptime.toFixed(1)}</td></tr>
 <tr><td>Posts</td><td>${status.counts.posts}</td></tr>
 <tr><td>Channels</td><td>${status.counts.channels}</td></tr>
 <tr><td>Users</td><td>${status.counts.users}</td></tr>
 <tr><td>Version</td><td>${status.version || "n/a"}</td></tr>
 <tr><td>Port</td><td>${status.port}</td></tr>
 <tr><td>Timestamp</td><td>${status.timestamp}</td></tr>
</table>
<h2>Features (Implemented)</h2>
<ul>
 <li>Channel connection (public & private)</li>
 <li>Multiple channels per admin</li>
 <li>Draft creation (text, media, buttons)</li>
 <li>Scheduling & recurring jobs</li>
 <li>Inline buttons</li>
</ul>
<h2>Usage</h2>
<p>Interact with the bot on Telegram after inviting it to your channels with the proper admin rights.</p>
<h2>API Surface</h2>
<p>No public REST API; this endpoint is for health & info. JSON: append <code>?format=json</code>.</p>
<footer><small>&copy; Postify</small></footer>
</html>`;

  async function docsHandler(req: FastifyRequest, reply: FastifyReply) {
    const status = (await buildStatus()) as StatusInfo;
    const query = req.query as { format?: string } | undefined;
    if (query?.format === "json") return status;
    reply.type("text/html").send(renderDocs(status));
  }

  app.get("/docs", docsHandler);
  app.get("/", docsHandler);

  return app;
}

export function startHttpServer(): FastifyInstance {
  const app = createServer();
  app
    .listen({ port: env.PORT, host: "127.0.0.1" })
    .then((address: string) =>
      logger.info({ address }, "HTTP server listening"),
    )
    .catch((err: unknown) => {
      logger.error({ err }, "HTTP server failed to start");
      process.exit(1);
    });
  return app;
}
