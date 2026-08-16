const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4301);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "contas.json");
const MAX_BODY_SIZE = 5 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function validateData(value) {
  return value && typeof value === "object" && Array.isArray(value.vendors) && value.settings && typeof value.settings === "object";
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) throw new Error("Arquivo maior que 5 MB.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeData(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryFile, DATA_FILE);
}

async function handleApi(request, response) {
  if (request.method === "GET") {
    return sendJson(response, 200, readData());
  }
  if (request.method === "PUT") {
    try {
      const data = await readBody(request);
      if (!validateData(data)) return sendJson(response, 400, { error: "Estrutura de dados inválida." });
      data.updatedAt = new Date().toISOString();
      writeData(data);
      return sendJson(response, 200, { ok: true, updatedAt: data.updatedAt });
    } catch (error) {
      return sendJson(response, 400, { error: error.message || "Não foi possível salvar." });
    }
  }
  return sendJson(response, 405, { error: "Método não permitido." });
}

function serveFile(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, `http://${HOST}`).pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) || filePath.startsWith(`${DATA_DIR}${path.sep}`)) {
    response.writeHead(404).end("Não encontrado");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500).end("Não encontrado");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(content);
  });
}

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) {
  writeData({ version: 2, updatedAt: null, settings: { weddingDate: "2026-11-07", couple: "Leonardo & Bruna" }, vendors: [] });
}

const server = http.createServer(async (request, response) => {
  if (new URL(request.url, `http://${HOST}`).pathname === "/api/data") {
    await handleApi(request, response);
    return;
  }
  serveFile(request, response);
});

server.listen(PORT, HOST, () => {
  console.log(`Casamento Contas: http://${HOST}:${PORT}`);
  console.log(`Dados: ${DATA_FILE}`);
});
