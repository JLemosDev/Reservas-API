import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { parseBookingDraft, parseWindow, type BookingStatus } from "./domain.ts";
import { Store } from "./store.ts";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const JSON_LIMIT = 16_384;

export type ApiError = {
  error: "invalid" | "not_found" | "conflict";
  message: string;
  fields?: Record<string, string>;
  conflicts?: unknown[];
};

export class HttpError extends Error {
  status: number;
  body: ApiError;

  constructor(status: number, body: ApiError) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > JSON_LIMIT) {
      throw new HttpError(400, { error: "invalid", message: "Corpo grande demais." });
    }
    chunks.push(buffer);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, { error: "invalid", message: "JSON inválido." });
  }
}

function publicFile(urlPath: string): string | null {
  const rel = urlPath === "/" ? "index.html" : decodeURIComponent(urlPath).replace(/^\/+/, "");
  if (rel.includes("\0")) return null;
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return null;
  return file;
}

async function sendFile(res: ServerResponse, file: string): Promise<void> {
  try {
    const body = await readFile(file);
    const type = TYPES[path.extname(file)] ?? "application/octet-stream";
    res.writeHead(200, { "content-type": type, "content-length": body.length });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "not_found", message: "Não encontrado." });
  }
}

export function createHandler(store: Store) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const route = `${req.method} ${url.pathname}`;

      if (route === "GET /api/resources") {
        sendJson(res, 200, { resources: store.listResources() });
        return;
      }

      if (route === "GET /api/bookings") {
        const window = parseWindow(url.searchParams.get("from"), url.searchParams.get("to"));
        if (!window.ok) {
          throw new HttpError(400, { error: "invalid", message: window.message });
        }
        const statusParam = url.searchParams.get("status") ?? "active";
        if (statusParam !== "active" && statusParam !== "cancelled" && statusParam !== "all") {
          throw new HttpError(400, { error: "invalid", message: "status deve ser active, cancelled ou all." });
        }
        const resourceId = url.searchParams.get("resourceId") ?? undefined;
        sendJson(res, 200, {
          bookings: store.listBookings({
            from: window.from,
            to: window.to,
            resourceId,
            status: statusParam as BookingStatus | "all",
          }),
        });
        return;
      }

      if (route === "POST /api/bookings") {
        const parsed = parseBookingDraft(await readJson(req));
        if (!parsed.ok) {
          throw new HttpError(400, {
            error: "invalid",
            message: "Revise os campos.",
            fields: parsed.fields,
          });
        }
        const result = store.createBooking(randomUUID(), parsed.value);
        if ("missing" in result) {
          throw new HttpError(404, { error: "not_found", message: "Sala não encontrada." });
        }
        if ("conflicts" in result) {
          throw new HttpError(409, {
            error: "conflict",
            message: "Este horário cruza com outra reserva nesta sala.",
            conflicts: result.conflicts,
          });
        }
        sendJson(res, 201, { booking: result.booking });
        return;
      }

      const cancel = route.match(/^DELETE \/api\/bookings\/([^/]+)$/);
      if (cancel) {
        const booking = store.cancelBooking(decodeURIComponent(cancel[1]));
        if (!booking) {
          throw new HttpError(404, { error: "not_found", message: "Reserva não encontrada." });
        }
        sendJson(res, 200, { booking });
        return;
      }

      if (req.method === "GET") {
        const file = publicFile(url.pathname);
        if (!file) {
          sendJson(res, 404, { error: "not_found", message: "Não encontrado." });
          return;
        }
        await sendFile(res, file);
        return;
      }

      sendJson(res, 404, { error: "not_found", message: "Não encontrado." });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, error.body);
        return;
      }
      sendJson(res, 500, { error: "invalid", message: "Erro interno." });
    }
  };
}

export function start(options: { port: number; host?: string; dbPath: string; seed?: boolean }) {
  const store = new Store(options.dbPath);
  if (options.seed !== false) store.seed();
  const server = createServer((req, res) => {
    void createHandler(store)(req, res);
  });
  const host = options.host ?? "127.0.0.1";
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(options.port, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        url: `http://${host}:${port}`,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => {
              store.close();
              if (error) reject(error);
              else done();
            });
          }),
      });
    });
  });
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) {
  const port = Number(process.env.PORT ?? 3000);
  const dbPath = process.env.DB_PATH ?? path.join(process.cwd(), "data", "reservas.sqlite");
  const running = await start({ port, dbPath });
  console.log(`Reservas em ${running.url}`);
}
