const MERCADO_PAGO_API = "https://api.mercadopago.com";
const ART_PRICE = 2;
const MAX_ARTWORK_BYTES = 20 * 1024 * 1024;
const ARTWORK_HASH_PATTERN = /^[a-f0-9]{64}$/;
const PAYMENT_ID_PATTERN = /^\d{1,24}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function responseHeaders(origin, env, extra = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Vary": "Origin",
    ...extra,
  });
  const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, X-Payment-Id, X-Artwork-Hash");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Access-Control-Expose-Headers", "Content-Disposition");
  }

  return headers;
}

function jsonResponse(body, status, origin, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin, env, { "Content-Type": "application/json; charset=utf-8" }),
  });
}

function requireAllowedOrigin(origin, env) {
  const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!origin || !allowedOrigins.includes(origin)) {
    throw new ApiError(403, "Origem não autorizada.");
  }
}

function normalizeCpf(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidCpf(value) {
  const cpf = normalizeCpf(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  for (let digit = 9; digit < 11; digit += 1) {
    let sum = 0;
    for (let index = 0; index < digit; index += 1) {
      sum += Number(cpf[index]) * (digit + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    const expected = remainder === 10 ? 0 : remainder;
    if (Number(cpf[digit]) !== expected) return false;
  }
  return true;
}

async function readBoundedBody(request, maximumBytes) {
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (contentLength > maximumBytes) throw new ApiError(413, "Arquivo acima do limite permitido.");
  if (!request.body) throw new ApiError(400, "Dados não recebidos.");

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new ApiError(413, "Arquivo acima do limite permitido.");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function readJsonBody(request) {
  const bytes = await readBoundedBody(request, 16 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "Dados do pagamento inválidos.");
  }
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mercadoPagoRequest(path, env, init = {}) {
  if (!env.MP_ACCESS_TOKEN) throw new ApiError(503, "Pagamento Pix ainda não configurado.");

  let response;
  try {
    response = await fetch(MERCADO_PAGO_API + path, {
      ...init,
      headers: {
        Authorization: "Bearer " + env.MP_ACCESS_TOKEN,
        Accept: "application/json",
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new ApiError(502, "Não foi possível consultar o Mercado Pago.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(502, "Resposta inválida do Mercado Pago.");
  }
  if (!response.ok) {
    console.error(JSON.stringify({
      event: "mercado_pago_request_failed",
      status: response.status,
      path,
    }));
    throw new ApiError(502, "Não foi possível concluir a operação Pix. Tente novamente.");
  }
  return data;
}

function validateArtworkHash(value) {
  if (typeof value !== "string" || !ARTWORK_HASH_PATTERN.test(value)) {
    throw new ApiError(400, "Montagem inválida.");
  }
  return value;
}

function validatePaymentId(value) {
  if (typeof value !== "string" || !PAYMENT_ID_PATTERN.test(value)) {
    throw new ApiError(400, "Pagamento inválido.");
  }
  return value;
}

async function createPixPayment(request, env) {
  const payload = await readJsonBody(request);
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const cpf = normalizeCpf(payload.cpf);
  const artworkHash = validateArtworkHash(payload.artworkHash);
  const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey : "";

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "Informe um e-mail válido.");
  }
  if (!isValidCpf(cpf)) throw new ApiError(400, "Confira o CPF informado.");
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new ApiError(400, "Não foi possível iniciar o pagamento. Tente novamente.");
  }

  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const payment = await mercadoPagoRequest("/v1/payments", env, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      transaction_amount: ART_PRICE,
      description: "Liberação da arte Meu Presidente",
      payment_method_id: "pix",
      external_reference: artworkHash,
      date_of_expiration: expiresAt,
      payer: {
        email,
        identification: { type: "CPF", number: cpf },
      },
    }),
  });

  const transactionData = payment.point_of_interaction?.transaction_data;
  if (!payment.id || !transactionData?.qr_code || !transactionData?.qr_code_base64) {
    console.error(JSON.stringify({
      event: "mercado_pago_pix_response_incomplete",
      hasPaymentId: Boolean(payment.id),
      hasQrCode: Boolean(transactionData?.qr_code),
      hasQrImage: Boolean(transactionData?.qr_code_base64),
    }));
    throw new ApiError(502, "O Mercado Pago não retornou o QR Code. Tente novamente.");
  }

  return {
    paymentId: String(payment.id),
    artworkHash,
    status: payment.status || "pending",
    qrCode: transactionData.qr_code,
    qrCodeBase64: transactionData.qr_code_base64,
    expiresAt: payment.date_of_expiration || expiresAt,
  };
}

async function findVerifiedPayment(paymentId, artworkHash, env) {
  const payment = await mercadoPagoRequest("/v1/payments/" + encodeURIComponent(paymentId), env);
  const matchesArtwork = payment.external_reference === artworkHash;
  const matchesAmount = Number(payment.transaction_amount) === ART_PRICE;
  const matchesCurrency = payment.currency_id === "BRL";
  const matchesMethod = payment.payment_method_id === "pix";

  if (!matchesArtwork || !matchesAmount || !matchesCurrency || !matchesMethod) {
    throw new ApiError(403, "Este pagamento não corresponde a esta arte.");
  }
  return payment;
}

async function readPaymentStatus(url, env) {
  const paymentId = validatePaymentId(url.searchParams.get("paymentId"));
  const artworkHash = validateArtworkHash(url.searchParams.get("artworkHash"));
  const payment = await findVerifiedPayment(paymentId, artworkHash, env);
  const transactionData = payment.point_of_interaction?.transaction_data;
  return {
    paymentId,
    artworkHash,
    status: payment.status,
    approved: payment.status === "approved",
    qrCode: transactionData?.qr_code || "",
    qrCodeBase64: transactionData?.qr_code_base64 || "",
    expiresAt: payment.date_of_expiration || "",
  };
}

async function returnPaidArtwork(request, env) {
  const paymentId = validatePaymentId(request.headers.get("X-Payment-Id"));
  const requestedHash = validateArtworkHash(request.headers.get("X-Artwork-Hash"));
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "image/png") {
    throw new ApiError(415, "Formato de imagem inválido.");
  }

  const bytes = await readBoundedBody(request, MAX_ARTWORK_BYTES);
  if (!bytes.byteLength) throw new ApiError(400, "Arquivo vazio.");
  const actualHash = await sha256Hex(bytes);
  if (actualHash !== requestedHash) throw new ApiError(403, "A imagem não corresponde ao pagamento.");

  const payment = await findVerifiedPayment(paymentId, actualHash, env);
  if (payment.status !== "approved") throw new ApiError(402, "O Pix ainda não foi aprovado.");

  return new Response(bytes, {
    status: 200,
    headers: responseHeaders(request.headers.get("Origin"), env, {
      "Content-Type": "image/png",
      "Content-Disposition": 'attachment; filename="meu-presidente.png"',
      "Content-Length": String(bytes.byteLength),
    }),
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/health") {
        if (origin) requireAllowedOrigin(origin, env);
        return jsonResponse({ ok: true }, 200, origin, env);
      }
      requireAllowedOrigin(origin, env);
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: responseHeaders(origin, env) });
      }

      if (request.method === "POST" && url.pathname === "/api/pix/create") {
        return jsonResponse(await createPixPayment(request, env), 201, origin, env);
      }
      if (request.method === "GET" && url.pathname === "/api/pix/status") {
        return jsonResponse(await readPaymentStatus(url, env), 200, origin, env);
      }
      if (request.method === "POST" && url.pathname === "/api/pix/export") {
        return returnPaidArtwork(request, env);
      }
      throw new ApiError(404, "Rota não encontrada.");
    } catch (error) {
      if (error instanceof ApiError) {
        return jsonResponse({ error: error.message }, error.status, origin, env);
      }
      console.error(JSON.stringify({
        event: "pix_worker_unhandled_error",
        error: error instanceof Error ? error.name : "unknown",
      }));
      return jsonResponse({ error: "Não foi possível concluir a operação. Tente novamente." }, 500, origin, env);
    }
  },
};
