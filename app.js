"use strict";

const CANDIDATES = [
  {
    number: "13", name: "Lula", ballotName: "LUIZ INÁCIO LULA DA SILVA", party: "PT",
    photo: "assets/candidatos/13.jpg", theme: "vermelho",
    presidentPhotos: ["assets/molduras/lula/1.jpg", "assets/molduras/lula/2.jpeg", "assets/molduras/lula/3.jpg", "assets/molduras/lula/4.jpeg"],
  },
  {
    number: "14", name: "Renan Santos", ballotName: "RENAN SANTOS", party: "MISSÃO",
    photo: "assets/candidatos/14.jpg", theme: "preto",
    presidentPhotos: ["assets/molduras/renan/1.webp", "assets/molduras/renan/2.jpeg", "assets/molduras/renan/3.png", "assets/molduras/renan/4.jpeg"],
  },
  {
    number: "22", name: "Flávio Bolsonaro", ballotName: "FLAVIO BOLSONARO", party: "PL",
    photo: "assets/candidatos/22.jpg", theme: "brasil",
    presidentPhotos: ["assets/molduras/flavio/1.jpeg", "assets/molduras/flavio/2.avif", "assets/molduras/flavio/3.jpeg", "assets/molduras/flavio/4.jpg"],
  },
];

const STORAGE_KEY = "meu-presidente:demo-v1";
const PAYMENT_ORDERS_KEY = "meu-presidente:pix-orders-v1";
const IMAGE_SIZE_LIMIT = 20 * 1024 * 1024;
const PAYMENT_POLL_INTERVAL = 5000;
const PAYMENT_POLL_WINDOW = 5 * 60 * 1000;
const PAYMENT_API_URL = String(window.MEU_PRESIDENTE_PIX_API_URL || "").replace(/\/+$/, "");
const ART_WIDTH = 1080;
const FORMATS = {
  feed: { label: "Feed", width: ART_WIDTH, height: 1350 },
  story: { label: "Story", width: ART_WIDTH, height: 1920 },
};

const elements = Object.fromEntries(
  [
    "photo-input", "upload-zone", "upload-label", "upload-description",
    "candidate-grid", "president-photo-grid", "format-toggle",
    "zoom", "zoom-label", "position", "position-label", "preview-stage",
    "preview-canvas", "preview-title", "preview-subtitle", "download-button",
    "download-label", "share-button", "share-label", "live-status", "toast",
    "pix-dialog", "pix-close-button", "pix-form", "pix-form-panel", "pix-email",
    "pix-cpf", "pix-submit-button", "pix-form-error", "pix-pending-panel",
    "pix-qr-image", "pix-copy-label", "pix-copy-code", "pix-copy-button", "pix-status-message",
    "pix-expiration", "pix-check-button", "pix-retry-button", "pix-approved-panel",
    "approved-download-button", "approved-share-button",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  photo: null,
  photoObjectUrl: "",
  selected: null,
  presidentPhoto: null,
  format: "feed",
  zoom: 100,
  position: 0,
  noticeTimer: 0,
  paymentOrders: new Map(),
  currentCheckout: null,
  paymentPollTimer: 0,
  paymentPollStartedAt: 0,
  paymentPollInFlight: false,
};

const presidentPhotoCache = new Map();
const presidentPhotoLoads = new Set();

function readSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved || saved.version !== 1) return;

    if (CANDIDATES.some((candidate) => candidate.number === saved.selected)) {
      state.selected = saved.selected;
      const candidate = candidateByNumber(state.selected);
      state.presidentPhoto = candidate.presidentPhotos.includes(saved.presidentPhoto)
        ? saved.presidentPhoto
        : candidate.presidentPhotos[0];
    }
    if (FORMATS[saved.format]) state.format = saved.format;
    if (Number.isInteger(saved.zoom) && saved.zoom >= 100 && saved.zoom <= 150) state.zoom = saved.zoom;
    if (Number.isInteger(saved.position) && saved.position >= -100 && saved.position <= 100) state.position = saved.position;

  } catch {
    announce("Não foi possível recuperar os ajustes salvos. Você pode criar sua arte normalmente.");
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      selected: state.selected,
      presidentPhoto: state.presidentPhoto,
      format: state.format,
      zoom: state.zoom,
      position: state.position,
    }));
    return true;
  } catch {
    announce("O navegador não conseguiu salvar seus ajustes; a alteração ficará ativa até você fechar a página.");
    return false;
  }
}

function savePaymentOrders() {
  try {
    const recentOrders = Array.from(state.paymentOrders.entries())
      .slice(-12)
      .map(([artworkHash, order]) => ({
        artworkHash,
        paymentId: order.paymentId || "",
        idempotencyKey: order.idempotencyKey || "",
        status: order.status,
        expiresAt: order.expiresAt || "",
      }));
    localStorage.setItem(PAYMENT_ORDERS_KEY, JSON.stringify(recentOrders));
  } catch {
    // Payment state is still checked directly by the Worker for this page session.
  }
}

function readSavedPaymentOrders() {
  try {
    const savedOrders = JSON.parse(localStorage.getItem(PAYMENT_ORDERS_KEY) || "[]");
    if (!Array.isArray(savedOrders)) return;

    for (const saved of savedOrders.slice(-12)) {
      if (!/^[a-f0-9]{64}$/.test(saved?.artworkHash || "")) continue;
      const paymentId = /^\d{1,24}$/.test(saved.paymentId || "") ? saved.paymentId : "";
      const idempotencyKey = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.idempotencyKey || "")
        ? saved.idempotencyKey
        : "";
      if (!paymentId && !(saved.status === "creating" && idempotencyKey)) continue;

      state.paymentOrders.set(saved.artworkHash, {
        paymentId,
        idempotencyKey,
        status: paymentId ? "needs-check" : "creating",
        expiresAt: saved.expiresAt || "",
      });
    }
  } catch {
    // A damaged local record should not stop the photo editor from loading.
  }
}

function announce(message) {
  elements["live-status"].textContent = message;
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(state.noticeTimer);
  state.noticeTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 5200);
}

function setPaymentButtonLabels(unlocked = false) {
  elements["download-label"].textContent = unlocked ? "Baixar minha arte" : "Baixar por R$ 2";
  elements["share-label"].textContent = unlocked ? "↗ Compartilhar minha arte" : "↗ Compartilhar por R$ 2";
}

function markCompositionChanged() {
  setPaymentButtonLabels(false);
}

function paymentApiIsConfigured() {
  try {
    return new URL(PAYMENT_API_URL).protocol === "https:";
  } catch {
    return false;
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

function formatCpfInput(value) {
  const digits = normalizeCpf(value).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return digits.slice(0, 3) + "." + digits.slice(3);
  if (digits.length <= 9) return digits.slice(0, 3) + "." + digits.slice(3, 6) + "." + digits.slice(6);
  return digits.slice(0, 3) + "." + digits.slice(3, 6) + "." + digits.slice(6, 9) + "-" + digits.slice(9);
}

async function artworkHash(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function pixApiRequest(path, init = {}) {
  if (!paymentApiIsConfigured()) {
    throw new Error("O pagamento Pix ainda não foi ativado neste site.");
  }
  const response = await fetch(PAYMENT_API_URL + path, {
    cache: "no-store",
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Não foi possível concluir a operação Pix. Tente novamente.");
  }
  return data;
}

function candidateByNumber(number) {
  return CANDIDATES.find((candidate) => candidate.number === number) || null;
}

function renderCandidateGrid() {
  elements["candidate-grid"].replaceChildren();
  for (const candidate of CANDIDATES) {
    const card = document.createElement("button");
    card.className = "candidate-card";
    card.type = "button";
    card.setAttribute("aria-pressed", String(state.selected === candidate.number));
    card.setAttribute("aria-label", `Selecionar ${candidate.name}, número ${candidate.number}, partido ${candidate.party}`);

    const photo = document.createElement("img");
    photo.src = candidate.photo;
    photo.alt = "";
    photo.loading = "lazy";
    photo.width = 39;
    photo.height = 43;
    photo.addEventListener("error", () => { photo.hidden = true; }, { once: true });

    const info = document.createElement("span");
    info.className = "candidate-info";
    const name = document.createElement("strong");
    name.textContent = candidate.name;
    const party = document.createElement("small");
    party.textContent = `${candidate.party} · Presidência`;
    info.append(name, party);

    const number = document.createElement("span");
    number.className = "candidate-number";
    number.textContent = candidate.number;
    card.append(photo, info, number);
    card.addEventListener("click", () => {
      if (state.selected === candidate.number) return;
      state.selected = candidate.number;
      state.presidentPhoto = candidate.presidentPhotos[0];
      markCompositionChanged();
      saveState();
      ensurePresidentPhotoLoaded(state.presidentPhoto);
      renderAll();
    });
    elements["candidate-grid"].append(card);
  }
}

function renderPresidentPhotoGrid() {
  const grid = elements["president-photo-grid"];
  const candidate = candidateByNumber(state.selected);
  grid.replaceChildren();

  if (!candidate) {
    const prompt = document.createElement("p");
    prompt.className = "president-photo-prompt";
    prompt.textContent = "Escolha um candidato no passo 2 para ver as fotos disponíveis.";
    grid.append(prompt);
    grid.setAttribute("aria-label", "Escolha um candidato para ver as fotos do presidente");
    return;
  }

  grid.setAttribute("aria-label", `Fotos de ${candidate.name}`);
  for (const [index, source] of candidate.presidentPhotos.entries()) {
    const option = document.createElement("button");
    option.className = "president-photo-option";
    option.type = "button";
    option.setAttribute("aria-pressed", String(state.presidentPhoto === source));
    option.setAttribute("aria-label", `Escolher foto ${index + 1} de ${candidate.name}`);

    const image = document.createElement("img");
    image.src = source;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => { image.hidden = true; }, { once: true });
    option.append(image);
    option.addEventListener("click", () => {
      if (state.presidentPhoto === source) return;
      state.presidentPhoto = source;
      markCompositionChanged();
      saveState();
      ensurePresidentPhotoLoaded(source);
      renderAll();
    });
    grid.append(option);
  }
}

function ensurePresidentPhotoLoaded(source) {
  if (!source || presidentPhotoCache.has(source) || presidentPhotoLoads.has(source)) return;
  presidentPhotoLoads.add(source);

  const image = new Image();
  image.addEventListener("load", () => {
    presidentPhotoLoads.delete(source);
    presidentPhotoCache.set(source, image);
    if (state.presidentPhoto === source) updatePreview();
  }, { once: true });
  image.addEventListener("error", () => {
    presidentPhotoLoads.delete(source);
    if (state.presidentPhoto === source) {
      updatePreview();
      announce("Não foi possível carregar esta foto. Escolha outra opção.");
    }
  }, { once: true });
  image.src = source;
}

function canvasContext(canvas) {
  return canvas.getContext("2d", { alpha: false });
}

function drawPlaceholder(context, width, height, title = "ADICIONE SUA FOTO", subtitle = "Sua imagem fica neste navegador", x = 0, y = 0) {
  context.fillStyle = "#dce5d7";
  context.fillRect(x, y, width, height);
  const gradient = context.createRadialGradient(x + width * .48, y + height * .37, 4, x + width * .48, y + height * .37, width * .7);
  gradient.addColorStop(0, "#edf1de");
  gradient.addColorStop(1, "#c5d6c1");
  context.fillStyle = gradient;
  context.fillRect(x, y, width, height);
  context.fillStyle = "#55745d";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = '700 27px "DM Sans", Arial, sans-serif';
  context.fillText(title, x + width / 2, y + height * .41, width * .8);
  context.font = '600 19px "DM Sans", Arial, sans-serif';
  context.fillText(subtitle, x + width / 2, y + height * .47, width * .8);
}

function drawCoverImage(context, image, x, y, width, height, zoom = 100, position = 0) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight) * (zoom / 100);
  const imageWidth = sourceWidth * scale;
  const imageHeight = sourceHeight * scale;
  const excessY = height - imageHeight;
  const imageX = x + (width - imageWidth) / 2;
  const imageY = y + excessY / 2 + (excessY / 2) * (position / 100);

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(image, imageX, imageY, imageWidth, imageHeight);
  context.restore();
}

function drawArtwork(canvas, { fullSize = false } = {}) {
  const ctx = canvasContext(canvas);
  if (!ctx) return;
  const { width, height } = FORMATS[state.format];
  const outputScale = fullSize ? 1 : 0.5;
  canvas.width = width * outputScale;
  canvas.height = height * outputScale;
  ctx.scale(outputScale, outputScale);

  const candidate = candidateByNumber(state.selected);
  const theme = candidate?.theme || "brasil";
  const palettes = {
    brasil: { primary: "#075b43", paper: "#f7f8ec", accent: "#e9f46a", border: "#075b43" },
    vermelho: { primary: "#a72b39", paper: "#fff4e6", accent: "#f1c6ab", border: "#a72b39" },
    preto: { primary: "#171717", paper: "#fffbe9", accent: "#f2c230", border: "#f2c230" },
  };
  const palette = palettes[theme];
  const presidentImage = presidentPhotoCache.get(state.presidentPhoto);
  const presidentPhotoHeight = height * .49;
  const lowerTop = presidentPhotoHeight - height * .025;

  ctx.fillStyle = palette.primary;
  ctx.fillRect(0, 0, width, height);
  if (presidentImage) {
    drawCoverImage(ctx, presidentImage, 0, 0, width, presidentPhotoHeight);
  } else if (candidate) {
    drawPlaceholder(ctx, width, presidentPhotoHeight, "CARREGANDO FOTO", "Aguarde um instante");
  } else {
    drawPlaceholder(ctx, width, presidentPhotoHeight, "ESCOLHA UM CANDIDATO", "As fotos aparecem no passo 3");
  }

  ctx.beginPath();
  ctx.moveTo(0, lowerTop);
  ctx.lineTo(width, presidentPhotoHeight - height * .035);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = palette.accent;
  ctx.beginPath();
  ctx.moveTo(0, presidentPhotoHeight - height * .048);
  ctx.lineTo(width, presidentPhotoHeight - height * .065);
  ctx.lineTo(width, presidentPhotoHeight - height * .035);
  ctx.lineTo(0, presidentPhotoHeight - height * .018);
  ctx.closePath();
  ctx.fill();

  if (theme === "vermelho") {
    ctx.strokeStyle = palette.paper;
    ctx.lineWidth = 11;
    ctx.strokeRect(17, 17, width - 34, height - 34);
  } else if (theme === "preto") {
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 15;
    ctx.strokeRect(24, 24, width - 48, height - 48);
  }

  if (candidate) {
    ctx.fillStyle = theme === "vermelho" ? palette.paper : palette.accent;
    ctx.fillRect(0, 62, width * .36, 83);
    ctx.fillStyle = palette.primary;
    ctx.font = '800 22px "DM Sans", Arial, sans-serif';
    ctx.fillText("MEU PRESIDENTE", 59, 113);
  }

  const photoX = width * .08;
  const photoWidth = width * .84;
  const availableHeight = height - lowerTop - height * .055;
  const photoHeight = availableHeight * .76;
  const numberSize = width * .082;
  const labelSize = width * .044;
  const labelGap = width * .018;
  const dividerY = presidentPhotoHeight - height * .027;
  const labelRowHeight = numberSize;
  const labelY = dividerY + labelGap + labelRowHeight / 2;
  const photoY = labelY + labelRowHeight / 2 + labelGap;

  if (state.photo) {
    drawCoverImage(ctx, state.photo, photoX, photoY, photoWidth, photoHeight, state.zoom, state.position);
  } else {
    drawPlaceholder(ctx, photoWidth, photoHeight, "SUA FOTO AQUI", "Escolha uma foto no passo 1", photoX, photoY);
  }

  ctx.strokeStyle = palette.accent;
  ctx.lineWidth = 5;
  ctx.strokeRect(photoX, photoY, photoWidth, photoHeight);

  if (candidate) {
    const label = `Juntos com ${candidate.name}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${numberSize}px Outfit, Arial, sans-serif`;
    const numberWidth = ctx.measureText(candidate.number).width;
    ctx.font = `800 ${labelSize}px "DM Sans", Arial, sans-serif`;
    const labelWidth = ctx.measureText(label).width;
    const rowWidth = numberWidth + labelGap + labelWidth;
    const scale = Math.min(1, width * .9 / rowWidth);

    ctx.save();
    ctx.translate(width / 2, labelY);
    ctx.scale(scale, scale);
    ctx.lineJoin = "round";
    ctx.lineWidth = width * .006;
    ctx.strokeStyle = "rgba(0, 0, 0, .9)";
    ctx.shadowColor = "rgba(0, 0, 0, .75)";
    ctx.shadowBlur = width * .012;
    ctx.shadowOffsetY = width * .003;

    const rowStart = -rowWidth / 2;
    ctx.fillStyle = palette.accent;
    ctx.font = `900 ${numberSize}px Outfit, Arial, sans-serif`;
    ctx.strokeText(candidate.number, rowStart, 0);
    ctx.fillText(candidate.number, rowStart, 0);

    ctx.fillStyle = palette.paper;
    ctx.font = `800 ${labelSize}px "DM Sans", Arial, sans-serif`;
    const labelX = rowStart + numberWidth + labelGap;
    ctx.strokeText(label, labelX, 0);
    ctx.fillText(label, labelX, 0);
    ctx.restore();
  }

  ctx.strokeStyle = palette.border;
  ctx.lineWidth = theme === "preto" ? 15 : 21;
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, width - ctx.lineWidth, height - ctx.lineWidth);
}

function updatePreview() {
  const story = state.format === "story";
  elements["preview-stage"].classList.toggle("is-story", story);
  drawArtwork(elements["preview-canvas"]);
  const candidate = candidateByNumber(state.selected);
  const presidentPhotoReady = Boolean(state.presidentPhoto && presidentPhotoCache.has(state.presidentPhoto));
  elements["preview-title"].textContent = candidate ? `Sua criação para ${candidate.name}` : "Uma arte feita por você";
  elements["preview-subtitle"].textContent = !candidate
    ? "Escolha um candidato no passo 2."
    : !presidentPhotoReady
      ? "Carregando a foto do presidente…"
      : state.photo
        ? `${candidate.name} · ${story ? "Story 1080 × 1920" : "Feed 1080 × 1350"}`
        : "Adicione sua foto para completar a arte.";
  elements["download-button"].disabled = !state.photo || !candidate || !presidentPhotoReady;
  elements["share-button"].disabled = !state.photo || !candidate || !presidentPhotoReady;
}

function renderFormatButtons() {
  for (const button of elements["format-toggle"].querySelectorAll("[data-format]")) {
    const selected = button.dataset.format === state.format;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  elements.zoom.value = String(state.zoom);
  elements["zoom-label"].textContent = `${state.zoom}%`;
  elements.position.value = String(state.position);
  elements["position-label"].textContent = state.position === 0 ? "Centro" : state.position < 0 ? "Acima" : "Abaixo";
}

function renderAll() {
  renderCandidateGrid();
  renderPresidentPhotoGrid();
  renderFormatButtons();
  updatePreview();
}

function decodeLocalImage(file) {
  if (typeof window.createImageBitmap === "function") return window.createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.addEventListener("load", () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    }, { once: true });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("invalid-image"));
    }, { once: true });
    image.src = objectUrl;
  });
}

async function loadPhoto(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    announce("Escolha uma imagem JPG, PNG ou WebP.");
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    announce("Escolha uma imagem JPG, PNG ou WebP.");
    return;
  }
  if (file.size > IMAGE_SIZE_LIMIT) {
    announce("A foto precisa ter no máximo 20 MB.");
    return;
  }

  try {
    const decoded = await decodeLocalImage(file);
    if (!decoded.width || !decoded.height) throw new Error("empty-image");
    if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
    state.photo = decoded;
    state.photoObjectUrl = URL.createObjectURL(file);
    markCompositionChanged();
    state.zoom = 100;
    state.position = 0;
    elements["upload-zone"].classList.add("has-photo");
    elements["upload-label"].textContent = "Foto adicionada · trocar foto";
    elements["upload-description"].textContent = `${decoded.width} × ${decoded.height} px · somente nesta sessão`;
    saveState();
    renderAll();
    announce("Foto pronta. Ajuste o enquadramento na prévia.");
  } catch {
    announce("Não foi possível abrir essa imagem. Tente outro arquivo JPG, PNG ou WebP.");
  } finally {
    elements["photo-input"].value = "";
  }
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("empty-blob")), "image/png");
  });
}

async function createFinalImage() {
  const candidate = candidateByNumber(state.selected);
  if (!candidate || !state.photo || !presidentPhotoCache.has(state.presidentPhoto)) {
    announce("Adicione sua foto, escolha um candidato e aguarde a foto presidencial carregar.");
    return null;
  }
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  drawArtwork(canvas, { fullSize: true });
  return { blob: await canvasToBlob(canvas), candidate, format: state.format };
}

function stopPaymentPolling() {
  window.clearTimeout(state.paymentPollTimer);
  state.paymentPollTimer = 0;
}

function showPixForm(message = "") {
  elements["pix-form-panel"].hidden = false;
  elements["pix-pending-panel"].hidden = true;
  elements["pix-approved-panel"].hidden = true;
  elements["pix-form-error"].textContent = message;
  elements["pix-form-error"].hidden = !message;
}

function showPendingPix(order) {
  elements["pix-form-panel"].hidden = true;
  elements["pix-pending-panel"].hidden = false;
  elements["pix-approved-panel"].hidden = true;
  const hasQr = Boolean(order.qrCodeBase64 && order.qrCode);
  elements["pix-qr-image"].hidden = !hasQr;
  elements["pix-copy-label"].hidden = !hasQr;
  elements["pix-copy-code"].hidden = !hasQr;
  elements["pix-copy-button"].hidden = !hasQr;
  if (hasQr) {
    elements["pix-qr-image"].src = "data:image/png;base64," + order.qrCodeBase64;
    elements["pix-copy-code"].value = order.qrCode;
  }
  elements["pix-status-message"].textContent = hasQr
    ? "Aguardando a confirmação do pagamento…"
    : "Verificando o Pix anterior…";
  elements["pix-check-button"].hidden = false;
  elements["pix-retry-button"].hidden = true;
  const expiration = new Date(order.expiresAt);
  elements["pix-expiration"].textContent = Number.isNaN(expiration.getTime())
    ? ""
    : "Este Pix vence em " + expiration.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) + ".";
}

function showApprovedPix() {
  elements["pix-form-panel"].hidden = true;
  elements["pix-pending-panel"].hidden = true;
  elements["pix-approved-panel"].hidden = false;
  setPaymentButtonLabels(true);
  announce("Pix confirmado. Download e compartilhamento liberados para esta montagem.");
}

function showPixDialog(artifact) {
  if (!paymentApiIsConfigured()) {
    announce("O pagamento Pix ainda não foi ativado. Configure o backend para liberar o download e o compartilhamento.");
    return false;
  }

  state.currentCheckout = { artifact };
  let order = state.paymentOrders.get(artifact.hash);

  if (order?.status === "approved") {
      showApprovedPix();
  } else if (order?.paymentId && ["pending", "needs-check"].includes(order.status)) {
    showPendingPix(order);
  } else {
    if (order && ["rejected", "cancelled", "expired", "refunded", "charged_back"].includes(order.status)) {
      state.paymentOrders.delete(artifact.hash);
      savePaymentOrders();
      order = null;
    }
    showPixForm();
  }

  if (!elements["pix-dialog"].open) elements["pix-dialog"].showModal();
  if (order?.paymentId && ["pending", "needs-check"].includes(order.status)) startPaymentPolling(artifact.hash);
  return true;
}

function scheduleNextPaymentCheck(hash) {
  if (!elements["pix-dialog"].open || state.currentCheckout?.artifact.hash !== hash) return;
  if (Date.now() - state.paymentPollStartedAt >= PAYMENT_POLL_WINDOW) {
    elements["pix-status-message"].textContent = "Ainda não conseguimos confirmar. Se você já pagou, toque em “Já paguei, verificar agora”.";
    return;
  }
  window.clearTimeout(state.paymentPollTimer);
  state.paymentPollTimer = window.setTimeout(() => checkPixPayment(hash), PAYMENT_POLL_INTERVAL);
}

async function checkPixPayment(hash) {
  if (state.paymentPollInFlight || state.currentCheckout?.artifact.hash !== hash) return;
  const order = state.paymentOrders.get(hash);
  if (!order?.paymentId) return;

  state.paymentPollInFlight = true;
  let scheduleAgain = false;
  try {
    const query = new URLSearchParams({ paymentId: order.paymentId, artworkHash: hash });
    const result = await pixApiRequest("/api/pix/status?" + query.toString());
    if (state.currentCheckout?.artifact.hash !== hash) return;

    if (result.approved && result.status === "approved") {
      order.status = "approved";
      state.paymentOrders.set(hash, order);
      savePaymentOrders();
      stopPaymentPolling();
      showApprovedPix();
      return;
    }

    if (["rejected", "cancelled", "expired", "refunded", "charged_back"].includes(result.status)) {
      order.status = result.status;
      state.paymentOrders.set(hash, order);
      savePaymentOrders();
      stopPaymentPolling();
      elements["pix-status-message"].textContent = "Este Pix não foi aprovado. Você pode gerar uma nova cobrança.";
      elements["pix-check-button"].hidden = true;
      elements["pix-retry-button"].hidden = false;
      return;
    }

    order.status = "pending";
    order.qrCode = result.qrCode || order.qrCode || "";
    order.qrCodeBase64 = result.qrCodeBase64 || order.qrCodeBase64 || "";
    order.expiresAt = result.expiresAt || order.expiresAt || "";
    state.paymentOrders.set(hash, order);
    savePaymentOrders();
    showPendingPix(order);
    elements["pix-status-message"].textContent = result.status === "in_process"
      ? "O banco está processando o pagamento. Vamos verificar novamente."
      : "Aguardando a confirmação do pagamento…";
    scheduleAgain = true;
  } catch (error) {
    if (state.currentCheckout?.artifact.hash === hash) {
      elements["pix-status-message"].textContent = error.message || "Não foi possível verificar agora. Tentaremos novamente.";
      scheduleAgain = true;
    }
  } finally {
    state.paymentPollInFlight = false;
    if (scheduleAgain) scheduleNextPaymentCheck(hash);
  }
}

function startPaymentPolling(hash) {
  stopPaymentPolling();
  state.paymentPollStartedAt = Date.now();
  checkPixPayment(hash);
}

async function createPixPayment(event) {
  event.preventDefault();
  const checkout = state.currentCheckout;
  if (!checkout) return;

  const email = elements["pix-email"].value.trim();
  const cpf = normalizeCpf(elements["pix-cpf"].value);
  if (!elements["pix-form"].reportValidity()) return;
  if (!isValidCpf(cpf)) {
    showPixForm("Confira o CPF informado.");
    elements["pix-cpf"].focus();
    return;
  }

  const hash = checkout.artifact.hash;
  let order = state.paymentOrders.get(hash);
  if (!order || !order.idempotencyKey) {
    order = { status: "creating", idempotencyKey: crypto.randomUUID() };
  } else {
    order.status = "creating";
  }
  state.paymentOrders.set(hash, order);
  savePaymentOrders();
  elements["pix-submit-button"].disabled = true;
  elements["pix-submit-button"].textContent = "Gerando Pix…";
  elements["pix-form-error"].hidden = true;

  try {
    const result = await pixApiRequest("/api/pix/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        cpf,
        artworkHash: hash,
        idempotencyKey: order.idempotencyKey,
      }),
    });
    order = {
      ...order,
      paymentId: result.paymentId,
      status: result.status === "approved" ? "approved" : "pending",
      qrCode: result.qrCode,
      qrCodeBase64: result.qrCodeBase64,
      expiresAt: result.expiresAt,
    };
    state.paymentOrders.set(hash, order);
    savePaymentOrders();
    if (order.status === "approved") {
      showApprovedPix();
    } else {
      showPendingPix(order);
      startPaymentPolling(hash);
    }
  } catch (error) {
    showPixForm(error.message || "Não foi possível gerar o Pix. Tente novamente.");
  } finally {
    elements["pix-submit-button"].disabled = false;
    elements["pix-submit-button"].textContent = "Gerar Pix de R$ 2";
  }
}

function downloadBlob(blob, artifact) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "meu-presidente-" + artifact.candidate.number + "-" + artifact.format + ".png";
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2000);
}

async function fetchApprovedArtwork(artifact, order) {
  const response = await fetch(PAYMENT_API_URL + "/api/pix/export", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "image/png",
      "X-Payment-Id": order.paymentId,
      "X-Artwork-Hash": artifact.hash,
    },
    body: artifact.blob,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 402 || response.status === 403) {
      order.status = "rejected";
      savePaymentOrders();
      setPaymentButtonLabels(false);
    }
    throw new Error(data.error || "Não foi possível exportar a imagem. Tente novamente.");
  }
  return response.blob();
}

async function performPaidAction(action, artifact, order) {
  const verifiedBlob = await fetchApprovedArtwork(artifact, order);
  if (action === "share" && navigator.share && navigator.canShare) {
    const fileName = "meu-presidente-" + artifact.candidate.number + "-" + artifact.format + ".png";
    const file = new File([verifiedBlob], fileName, { type: "image/png" });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "Minha arte · " + artifact.candidate.name,
          text: "Minha escolha, do meu jeito.",
        });
        announce("Arte pronta para compartilhar.");
        return true;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return false;
      }
    }
  }

  downloadBlob(verifiedBlob, artifact);
  announce(action === "share"
    ? "Arte baixada. Compartilhe pelo aplicativo que preferir."
    : "Arte " + FORMATS[artifact.format].label + " baixada em PNG.");
  return true;
}

async function handleProtectedAction(action) {
  const button = action === "download" ? elements["download-button"] : elements["share-button"];
  button.disabled = true;
  try {
    const result = await createFinalImage();
    if (!result) return;
    const artifact = { ...result, hash: await artworkHash(result.blob) };
    const order = state.paymentOrders.get(artifact.hash);

    if (order?.status === "approved") {
      setPaymentButtonLabels(true);
      await performPaidAction(action, artifact, order);
      return;
    }
    if (order && ["rejected", "cancelled", "expired", "refunded", "charged_back"].includes(order.status)) {
      state.paymentOrders.delete(artifact.hash);
      savePaymentOrders();
    }
    showPixDialog(artifact);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    announce(error.message || "Não foi possível preparar a imagem. Tente novamente.");
  } finally {
    button.disabled = false;
    updatePreview();
  }
}

async function performApprovedDialogAction(action) {
  const checkout = state.currentCheckout;
  if (!checkout) return;
  const button = action === "download"
    ? elements["approved-download-button"]
    : elements["approved-share-button"];
  const order = state.paymentOrders.get(checkout.artifact.hash);
  if (!order?.paymentId || order.status !== "approved") {
    announce("Não foi possível confirmar a liberação. Verifique o Pix novamente.");
    return;
  }

  button.disabled = true;
  try {
    const succeeded = await performPaidAction(action, checkout.artifact, order);
    if (succeeded && elements["pix-dialog"].open) elements["pix-dialog"].close();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (order.status === "rejected") {
      showPixForm("Não foi possível validar este pagamento. Você pode gerar um novo Pix para a montagem.");
    }
    announce(error.message || "Não foi possível exportar a imagem. Tente novamente.");
  } finally {
    button.disabled = false;
  }
}

async function copyPixCode() {
  const code = elements["pix-copy-code"].value;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
    } else {
      elements["pix-copy-code"].focus();
      elements["pix-copy-code"].select();
      if (!document.execCommand("copy")) throw new Error("copy-failed");
    }
    elements["pix-status-message"].textContent = "Código Pix copiado. Cole no aplicativo do seu banco.";
  } catch {
    elements["pix-copy-code"].focus();
    elements["pix-copy-code"].select();
    elements["pix-status-message"].textContent = "Selecione e copie o código para colar no aplicativo do seu banco.";
  }
}

function retryPixPayment() {
  const hash = state.currentCheckout?.artifact.hash;
  if (!hash) return;
  state.paymentOrders.delete(hash);
  savePaymentOrders();
  stopPaymentPolling();
  showPixForm("Gere um novo Pix de R$ 2 para esta montagem.");
}

elements["photo-input"].addEventListener("change", (event) => loadPhoto(event.currentTarget.files?.[0]));
elements["upload-zone"].addEventListener("click", () => elements["photo-input"].click());
elements["upload-zone"].addEventListener("dragover", (event) => {
  event.preventDefault();
  elements["upload-zone"].classList.add("is-dragging");
});
elements["upload-zone"].addEventListener("dragleave", () => elements["upload-zone"].classList.remove("is-dragging"));
elements["upload-zone"].addEventListener("drop", (event) => {
  event.preventDefault();
  elements["upload-zone"].classList.remove("is-dragging");
  loadPhoto(event.dataTransfer?.files?.[0]);
});
elements["format-toggle"].addEventListener("click", (event) => {
  const button = event.target.closest("[data-format]");
  if (!button) return;
  state.format = button.dataset.format;
  markCompositionChanged();
  saveState();
  renderAll();
});
elements.zoom.addEventListener("input", () => {
  state.zoom = Number(elements.zoom.value);
  markCompositionChanged();
  renderFormatButtons();
  updatePreview();
});
elements.zoom.addEventListener("change", saveState);
elements.position.addEventListener("input", () => {
  state.position = Number(elements.position.value);
  markCompositionChanged();
  renderFormatButtons();
  updatePreview();
});
elements.position.addEventListener("change", saveState);
elements["download-button"].addEventListener("click", () => handleProtectedAction("download"));
elements["share-button"].addEventListener("click", () => handleProtectedAction("share"));
elements["pix-form"].addEventListener("submit", createPixPayment);
elements["pix-cpf"].addEventListener("input", (event) => {
  event.currentTarget.value = formatCpfInput(event.currentTarget.value);
});
elements["pix-copy-button"].addEventListener("click", copyPixCode);
elements["pix-check-button"].addEventListener("click", () => {
  if (!state.currentCheckout) return;
  state.paymentPollStartedAt = Date.now();
  checkPixPayment(state.currentCheckout.artifact.hash);
});
elements["pix-retry-button"].addEventListener("click", retryPixPayment);
elements["pix-close-button"].addEventListener("click", () => elements["pix-dialog"].close());
elements["pix-dialog"].addEventListener("close", stopPaymentPolling);
elements["approved-download-button"].addEventListener("click", () => performApprovedDialogAction("download"));
elements["approved-share-button"].addEventListener("click", () => performApprovedDialogAction("share"));

readSavedState();
readSavedPaymentOrders();
if (state.presidentPhoto) ensurePresidentPhotoLoaded(state.presidentPhoto);
renderAll();
window.addEventListener("beforeunload", () => {
  if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
});
