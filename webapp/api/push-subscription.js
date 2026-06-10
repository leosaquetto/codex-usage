const { removeSubscription, saveSubscription } = require("../lib/push-store");
const { sendPush } = require("../lib/push-service");

async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

module.exports = async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  try {
    const body = await readBody(request);
    if (request.method === "DELETE") {
      await removeSubscription(body?.subscription?.endpoint || body?.endpoint);
      return response.status(200).json({ ok: true, subscribed: false });
    }
    if (request.method !== "POST") {
      return response.status(405).json({ error: "Método não permitido." });
    }

    const result = await saveSubscription(body.subscription, body.preferences);
    let testSent = false;
    if (result.created && body.sendTest === true) {
      try {
        await sendPush(result.record.subscription, {
          title: "Notificações em background ativas",
          body: "O Codex Analytics já pode avisar mesmo com o app fechado.",
          tag: "codex-push-enabled",
          url: "/",
          timestamp: Date.now(),
        });
        testSent = true;
      } catch (error) {
        console.error("Subscription salva, mas o Push de teste falhou:", error?.message || error);
      }
    }
    return response.status(200).json({
      ok: true,
      subscribed: true,
      created: result.created,
      testSent,
    });
  } catch (error) {
    console.error("Falha ao salvar Web Push:", error);
    return response.status(500).json({ error: "Não foi possível registrar notificações em background." });
  }
};
