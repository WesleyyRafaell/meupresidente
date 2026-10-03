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
const IMAGE_SIZE_LIMIT = 20 * 1024 * 1024;
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
    "share-button", "live-status", "toast",
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

function announce(message) {
  elements["live-status"].textContent = message;
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.clearTimeout(state.noticeTimer);
  state.noticeTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 5200);
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
  return { blob: await canvasToBlob(canvas), candidate };
}

async function downloadImage() {
  elements["download-button"].disabled = true;
  try {
    const result = await createFinalImage();
    if (!result) return;
    const objectUrl = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `meu-presidente-${result.candidate.number}-${state.format}.png`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    announce(`Arte ${FORMATS[state.format].label} baixada em PNG. Agora você pode compartilhar!`);
  } catch {
    announce("Não foi possível exportar a imagem. Tente novamente.");
  } finally {
    updatePreview();
  }
}

async function shareImage() {
  if (!navigator.share || !navigator.canShare) {
    await downloadImage();
    if (!navigator.share) announce("Arte baixada. Compartilhe pelo aplicativo que preferir.");
    return;
  }
  elements["share-button"].disabled = true;
  try {
    const { blob, candidate } = await createFinalImage();
    if (!blob) return;
    const file = new File([blob], `meu-presidente-${candidate.number}-${state.format}.png`, { type: "image/png" });
    if (!navigator.canShare({ files: [file] })) {
      await downloadImage();
      return;
    }
    await navigator.share({ files: [file], title: `Minha arte · ${candidate.name}`, text: "Minha escolha, do meu jeito." });
    announce("Arte pronta para compartilhar.");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    announce("Não foi possível compartilhar. Baixe a arte e compartilhe pelo seu aplicativo favorito.");
  } finally {
    elements["share-button"].disabled = false;
  }
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
  saveState();
  renderAll();
});
elements.zoom.addEventListener("input", () => {
  state.zoom = Number(elements.zoom.value);
  renderFormatButtons();
  updatePreview();
});
elements.zoom.addEventListener("change", saveState);
elements.position.addEventListener("input", () => {
  state.position = Number(elements.position.value);
  renderFormatButtons();
  updatePreview();
});
elements.position.addEventListener("change", saveState);
elements["download-button"].addEventListener("click", downloadImage);
elements["share-button"].addEventListener("click", shareImage);

readSavedState();
if (state.presidentPhoto) ensurePresidentPhotoLoaded(state.presidentPhoto);
renderAll();
window.addEventListener("beforeunload", () => {
  if (state.photoObjectUrl) URL.revokeObjectURL(state.photoObjectUrl);
});
