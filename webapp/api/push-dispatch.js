const { timingSafeEqual } = require("node:crypto");
const { dispatchUsagePushes } = require("../lib/push-service");

function validSecret(request) {
  const expected = String(process.env.PUSH_DISPATCH_SECRET || "");
  const provided = String(request.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || !provided || expected.length !== provided.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  if (request.method !== "POST") return response.status(405).json({ error: "Método não permitido." });
  if (!validSecret(request)) return response.status(401).json({ error: "Não autorizado." });

  try {
    const body = await readBody(request);
    if (!body?.usage || typeof body.usage !== "object") {
      return response.status(400).json({ error: "Payload de uso ausente." });
    }
    const result = await dispatchUsagePushes(body.usage, body.hasLoadError === true);
    return response.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Falha no dispatch Web Push:", error);
    return response.status(500).json({ error: "Falha ao enviar notificações em background." });
  }
};
