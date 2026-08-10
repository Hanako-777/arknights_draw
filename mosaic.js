(() => {
  "use strict";

  const PALETTE = [
    "#222222", "#B4B4B4", "#EAE7DE", "#FFFFFF", "#D32F36",
    "#9D0A00", "#D60B4A", "#E6968D", "#FF9875", "#F7D0BF",
    "#FCEFE9", "#FCF6E8", "#DCD2C8", "#E2CEAB", "#D56422",
    "#D48C42", "#F29900", "#F8C933", "#FCE599", "#B3B47A",
    "#C1DA72", "#6C6E00", "#AA8B52", "#A98F74", "#AA9228",
    "#3F2B12", "#74491F", "#534658", "#2A2446", "#394599",
    "#59459C", "#BAA3D7", "#B6BCE0", "#A9ACBF", "#63ABB9",
    "#B4D2DC", "#90D8E6", "#48AEA0", "#B5D3C7", "#273864"
  ];
  const TILE_SIZE = 24;
  const TILES_PER_SIDE = 4;
  const MASTER_SIZE = TILE_SIZE * TILES_PER_SIDE;
  const MASTER_GAP_TO_TILE_RATIO = 1 / 7;
  const SAMPLE_BLOCK = 8;
  const SOURCE_SIZE = 560;
  const STORAGE_KEY = "arknights_draw-mosaic-grid-v1";
  const PROJECT_FORMAT = "arknights_draw-mosaic-project";
  const EXPORT_HISTORY_KEY = "arknights_draw-mosaic-export-history-v1";
  const EXPORT_HISTORY_LIMIT = 20;
  const TILE_ORDER = Array.from({ length: 16 }, (_, index) => 15 - index);
  const STACK_POSES = [
    { x: -1.00, y:  0.18, r: -1.00 },
    { x:  0.94, y: -0.28, r:  0.82 },
    { x:  0.12, y: -1.00, r: -0.58 },
    { x: -0.78, y: -0.68, r: -0.92 },
    { x:  0.72, y:  0.72, r:  1.00 },
    { x: -0.20, y:  1.00, r:  0.44 },
    { x:  1.00, y:  0.20, r:  0.70 },
    { x: -0.72, y:  0.76, r: -0.76 },
    { x:  0.66, y: -0.76, r:  0.94 },
    { x: -0.96, y: -0.22, r: -0.62 },
    { x:  0.26, y:  0.98, r:  0.88 },
    { x: -0.34, y: -0.96, r: -1.00 },
    { x:  0.98, y: -0.08, r:  0.56 },
    { x: -0.88, y:  0.48, r: -0.86 },
    { x:  0.48, y:  0.88, r:  0.68 }
  ];
  const DARK_IDS = [1, 26, 28, 29, 40];
  const RGB = PALETTE.map(hexToRgb);
  const PALETTE_LAB = RGB.map(([r, g, b]) => rgbToOklab(r, g, b));
  const PALETTE_CHROMA = PALETTE_LAB.map(([, a, b]) => Math.hypot(a, b));
  const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
      table[index] = value >>> 0;
    }
    return table;
  })();

  const $ = id => document.getElementById(id);
  const el = {
    imageInput: $("imageInput"), projectInput: $("projectInput"), dropZone: $("dropZone"),
    cropWrap: $("cropWrap"), sourceCanvas: $("sourceCanvas"), sourceMeta: $("sourceMeta"),
    removeImageBtn: $("removeImageBtn"), zoomRange: $("zoomRange"), zoomOut: $("zoomOut"),
    resetCropBtn: $("resetCropBtn"), fitSubjectBtn: $("fitSubjectBtn"), modeSelect: $("modeSelect"),
    contrastRange: $("contrastRange"), contrastOut: $("contrastOut"),
    saturationRange: $("saturationRange"), saturationOut: $("saturationOut"),
    generateBtn: $("generateBtn"), gridCanvas: $("gridCanvas"), masterCanvas: $("masterCanvas"),
    masterMeta: $("masterMeta"), cellInfo: $("cellInfo"), undoBtn: $("undoBtn"), redoBtn: $("redoBtn"),
    showNumbers: $("showNumbers"), showGrid: $("showGrid"), replaceFrom: $("replaceFrom"),
    replaceBtn: $("replaceBtn"), selectedBadge: $("selectedBadge"), palette: $("palette"),
    fileName: $("fileName"), saveProjectBtn: $("saveProjectBtn"), helpBtn: $("helpBtn"),
    helpPanel: $("helpPanel"), status: $("status"), exportPreviewBtn: $("exportPreviewBtn"),
    exportTotalBtn: $("exportTotalBtn"), prevTileBtn: $("prevTileBtn"), nextTileBtn: $("nextTileBtn"),
    exportHistory: $("exportHistory"), historyCount: $("historyCount"), clearHistoryBtn: $("clearHistoryBtn"),
    tileTitle: $("tileTitle"), tileProgressText: $("tileProgressText"), tileProgressBar: $("tileProgressBar"),
    tileCard: $("tileCard"), tileCardStack: $("tileCardStack"), tileCardBacks: $("tileCardBacks"),
    noticeDialog: $("mosaicNoticeDialog"),
    noticeCloseBtn: $("mosaicNoticeCloseBtn"), noticeConfirmBtn: $("mosaicNoticeConfirmBtn"),
    authorLinks: Array.from(document.querySelectorAll("[data-author-dialog]")),
    authorDialog: $("authorDialog"), authorCloseBtn: $("authorCloseBtn"), authorFlipCard: $("authorFlipCard")
  };

  const state = {
    image: null,
    imageUrl: "",
    zoom: 1,
    panX: 0,
    panY: 0,
    fitFull: false,
    cropDrag: null,
    masterGrid: new Uint8Array(MASTER_SIZE * MASTER_SIZE).fill(4),
    grid: new Uint8Array(TILE_SIZE * TILE_SIZE).fill(4),
    currentPosition: 0,
    selected: 1,
    tool: "paint",
    painting: false,
    mutationBefore: null,
    undo: [],
    redo: [],
    animating: false
  };

  const sourceCtx = el.sourceCanvas.getContext("2d", { willReadFrequently: true });
  const gridCtx = el.gridCanvas.getContext("2d");
  const masterCtx = el.masterCanvas.getContext("2d");
  let gridResizeObserver = null;
  let exportingDrawings = false;
  let exportHistory = [];

  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function srgbLinear(value) {
    const x = value / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  }

  function rgbToOklab(r, g, b) {
    r = srgbLinear(r); g = srgbLinear(g); b = srgbLinear(b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.680699545 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    ];
  }

  function nearestPaletteId(r, g, b) {
    const [l, a, b2] = rgbToOklab(r, g, b);
    const chroma = Math.hypot(a, b2);
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < PALETTE_LAB.length; i++) {
      const [pl, pa, pb] = PALETTE_LAB[i];
      const pc = PALETTE_CHROMA[i];
      let hueTermSquared = 0;
      if (chroma > 1e-12 && pc > 1e-12) {
        const cosine = Math.max(-1, Math.min(1, (a * pa + b2 * pb) / (chroma * pc)));
        hueTermSquared = 2 * chroma * pc * (1 - cosine);
      }
      const distance = 0.65 * (l - pl) ** 2 + (chroma - pc) ** 2 + 1.7 * hueTermSquared;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best + 1;
  }

  function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function adjustedRgb(r, g, b) {
    const contrast = 1 + Number(el.contrastRange.value) / 100;
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;
    const saturation = 1 + Number(el.saturationRange.value) / 100;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return [
      clampByte(gray + (r - gray) * saturation),
      clampByte(gray + (g - gray) * saturation),
      clampByte(gray + (b - gray) * saturation)
    ];
  }

  function colorText(rgb) {
    const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return luminance < 142 ? "#ffffff" : "#17201d";
  }

  function setStatus(message, isError = false) {
    el.status.textContent = message;
    el.status.style.color = isError ? "#a52020" : "";
  }

  function safeName() {
    const cleaned = (el.fileName.value || "arknights_draw_mosaic").trim().replace(/[\\/:*?"<>|]+/g, "_");
    return cleaned || "arknights_draw_mosaic";
  }

  function currentTileIndex() {
    return TILE_ORDER[state.currentPosition];
  }

  function tileDetails(tileIndex = currentTileIndex()) {
    return {
      number: tileIndex + 1,
      row: Math.floor(tileIndex / TILES_PER_SIDE),
      col: tileIndex % TILES_PER_SIDE
    };
  }

  function renderPalette() {
    el.palette.replaceChildren();
    el.replaceFrom.replaceChildren();
    PALETTE.forEach((hex, index) => {
      const id = index + 1;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.dataset.id = String(id);
      button.setAttribute("role", "option");
      const colorBlock = document.createElement("span");
      colorBlock.className = "swatch-color";
      colorBlock.style.background = hex;
      const info = document.createElement("span");
      info.className = "swatch-info";
      const number = document.createElement("strong");
      number.textContent = String(id).padStart(2, "0");
      const code = document.createElement("small");
      code.textContent = hex;
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = "0格";
      info.append(number, count, code);
      button.append(colorBlock, info);
      button.addEventListener("click", () => selectColor(id));
      el.palette.append(button);

      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = `${String(id).padStart(2, "0")} ${hex}`;
      el.replaceFrom.append(option);
    });
    selectColor(state.selected);
  }

  function renderCoordinateAxes() {
    document.querySelectorAll(".coord-axis").forEach(axis => {
      axis.replaceChildren();
      for (let value = 1; value <= TILE_SIZE; value++) {
        const label = document.createElement("span");
        label.textContent = String(value);
        axis.append(label);
      }
    });
  }

  function selectColor(id) {
    state.selected = Math.max(1, Math.min(40, Number(id) || 1));
    el.palette.querySelectorAll(".swatch").forEach(button => {
      const active = Number(button.dataset.id) === state.selected;
      button.classList.toggle("selected", active);
      button.setAttribute("aria-selected", String(active));
    });
    el.selectedBadge.textContent = `当前色 ${String(state.selected).padStart(2, "0")}`;
    el.selectedBadge.style.background = PALETTE[state.selected - 1];
    el.selectedBadge.style.color = colorText(RGB[state.selected - 1]);
  }

  function updatePaletteCounts() {
    const counts = new Uint16Array(41);
    state.grid.forEach(id => counts[id]++);
    el.palette.querySelectorAll(".swatch").forEach(button => {
      button.querySelector(".count").textContent = `${counts[Number(button.dataset.id)]}格`;
    });
  }

  function getImageTransform(width, height) {
    if (!state.image) return null;
    const cover = Math.max(width / state.image.width, height / state.image.height);
    const contain = Math.min(width / state.image.width, height / state.image.height);
    const scale = (state.fitFull ? contain : cover) * state.zoom;
    return {
      width: state.image.width * scale,
      height: state.image.height * scale,
      x: (width - state.image.width * scale) / 2 + state.panX * width / SOURCE_SIZE,
      y: (height - state.image.height * scale) / 2 + state.panY * height / SOURCE_SIZE
    };
  }

  function drawImageTo(ctx, width, height) {
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = PALETTE[3];
    ctx.fillRect(0, 0, width, height);
    const transform = getImageTransform(width, height);
    if (transform) ctx.drawImage(state.image, transform.x, transform.y, transform.width, transform.height);
    ctx.restore();
  }

  function drawSource() {
    sourceCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    drawImageTo(sourceCtx, SOURCE_SIZE, SOURCE_SIZE);
  }

  function resetCrop(full = false) {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.fitFull = full;
    el.zoomRange.value = "100";
    el.zoomOut.textContent = "100%";
    el.fitSubjectBtn.textContent = full ? "裁满画布" : "完整显示";
    drawSource();
  }

  function loadImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("请选择 PNG、JPG、WEBP 等图片文件。", true);
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
      state.imageUrl = url;
      state.image = image;
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.fitFull = false;
      el.zoomRange.value = "100";
      el.sourceMeta.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
      el.dropZone.hidden = true;
      el.cropWrap.hidden = false;
      el.generateBtn.disabled = false;
      el.fileName.value = file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "arknights_draw_mosaic";
      syncOutputs();
      drawSource();
      setStatus("图片已载入。调整裁剪后生成96×96大图初稿。 ");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("图片读取失败，请换一张图片重试。", true);
    };
    image.src = url;
  }

  function removeSourceImage() {
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = "";
    state.image = null;
    state.cropDrag = null;
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.fitFull = false;
    el.imageInput.value = "";
    el.sourceMeta.textContent = "尚未选择图片";
    el.cropWrap.hidden = true;
    el.dropZone.hidden = false;
    el.generateBtn.disabled = true;
    el.zoomRange.value = "100";
    syncOutputs();
    sourceCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    setStatus("已移除原图；96×96大图和当前施工进度已保留。 ");
  }

  function extractTile(tileIndex) {
    const result = new Uint8Array(TILE_SIZE * TILE_SIZE);
    const { row: tileRow, col: tileCol } = tileDetails(tileIndex);
    for (let row = 0; row < TILE_SIZE; row++) {
      const masterStart = (tileRow * TILE_SIZE + row) * MASTER_SIZE + tileCol * TILE_SIZE;
      result.set(state.masterGrid.subarray(masterStart, masterStart + TILE_SIZE), row * TILE_SIZE);
    }
    return result;
  }

  function writeCurrentTileToMaster() {
    const { row: tileRow, col: tileCol } = tileDetails();
    for (let row = 0; row < TILE_SIZE; row++) {
      const masterStart = (tileRow * TILE_SIZE + row) * MASTER_SIZE + tileCol * TILE_SIZE;
      state.masterGrid.set(state.grid.subarray(row * TILE_SIZE, (row + 1) * TILE_SIZE), masterStart);
    }
  }

  function loadCurrentTile({ resetHistory = true } = {}) {
    state.grid = extractTile(currentTileIndex());
    if (resetHistory) {
      state.undo = [];
      state.redo = [];
    }
    drawGrid();
    drawMaster();
    updatePaletteCounts();
    updateHistoryButtons();
    updateTileNavigation();
  }

  function buildMasterFromImage() {
    if (!state.image) return;
    setStatus("正在分析9216个方格并匹配固定40色，请稍候……");
    el.generateBtn.disabled = true;
    window.setTimeout(() => {
      try {
        const sampleSize = MASTER_SIZE * SAMPLE_BLOCK;
        const sample = document.createElement("canvas");
        sample.width = sampleSize;
        sample.height = sampleSize;
        const ctx = sample.getContext("2d", { willReadFrequently: true });
        drawImageTo(ctx, sampleSize, sampleSize);
        const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
        const result = new Uint8Array(MASTER_SIZE * MASTER_SIZE);
        const mode = el.modeSelect.value;

        for (let row = 0; row < MASTER_SIZE; row++) {
          for (let col = 0; col < MASTER_SIZE; col++) {
            const counts = new Uint16Array(41);
            let sumR = 0, sumG = 0, sumB = 0;
            for (let y = 0; y < SAMPLE_BLOCK; y++) {
              for (let x = 0; x < SAMPLE_BLOCK; x++) {
                const pixel = ((row * SAMPLE_BLOCK + y) * sampleSize + col * SAMPLE_BLOCK + x) * 4;
                const adjusted = adjustedRgb(data[pixel], data[pixel + 1], data[pixel + 2]);
                sumR += adjusted[0]; sumG += adjusted[1]; sumB += adjusted[2];
                counts[nearestPaletteId(adjusted[0], adjusted[1], adjusted[2])]++;
              }
            }
            const total = SAMPLE_BLOCK * SAMPLE_BLOCK;
            const averageId = nearestPaletteId(sumR / total, sumG / total, sumB / total);
            let dominantId = 1;
            for (let id = 2; id <= 40; id++) if (counts[id] > counts[dominantId]) dominantId = id;
            let chosen = averageId;
            if (mode === "dominant") {
              chosen = dominantId;
            } else if (mode === "hybrid") {
              let darkTotal = 0;
              let darkId = DARK_IDS[0];
              DARK_IDS.forEach(id => {
                darkTotal += counts[id];
                if (counts[id] > counts[darkId]) darkId = id;
              });
              if (darkTotal / total >= 0.18) chosen = darkId;
              else if (counts[dominantId] / total >= 0.36) chosen = dominantId;
            }
            result[row * MASTER_SIZE + col] = chosen;
          }
        }

        state.masterGrid = result;
        state.currentPosition = 0;
        loadCurrentTile();
        saveLocal();
        const usedColors = new Set(result).size;
        el.masterMeta.textContent = `96×96 · 16张24×24 · ${usedColors}色`;
        setStatus(`96×96大图已生成，共使用 ${usedColors} 种固定色。从右下角16号画板开始施工。`);
      } catch (error) {
        console.error(error);
        setStatus(`转换失败：${error.message}`, true);
      } finally {
        el.generateBtn.disabled = false;
      }
    }, 30);
  }

  function drawGrid() {
    const size = el.gridCanvas.width;
    const cell = size / TILE_SIZE;
    gridCtx.clearRect(0, 0, size, size);
    gridCtx.imageSmoothingEnabled = false;
    gridCtx.textAlign = "center";
    gridCtx.textBaseline = "middle";
    gridCtx.font = `900 ${cell * 0.48}px Consolas, "Cascadia Mono", monospace`;
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let col = 0; col < TILE_SIZE; col++) {
        const id = state.grid[row * TILE_SIZE + col];
        gridCtx.fillStyle = PALETTE[id - 1];
        gridCtx.fillRect(col * cell, row * cell, cell + 0.2, cell + 0.2);
        if (el.showNumbers.checked) {
          gridCtx.fillStyle = colorText(RGB[id - 1]);
          gridCtx.fillText(String(id).padStart(2, "0"), (col + 0.5) * cell, (row + 0.52) * cell);
        }
      }
    }
    if (el.showGrid.checked) {
      gridCtx.beginPath();
      for (let i = 0; i <= TILE_SIZE; i++) {
        const value = Math.round(i * cell) + 0.5;
        gridCtx.moveTo(value, 0); gridCtx.lineTo(value, size);
        gridCtx.moveTo(0, value); gridCtx.lineTo(size, value);
      }
      gridCtx.strokeStyle = "rgba(18,22,20,.58)";
      gridCtx.lineWidth = Math.max(1, size / 900);
      gridCtx.stroke();
    }
  }

  function drawMasterTiles(ctx, size, { labels = false, active = false, gapPixels = null } = {}) {
    const gap = gapPixels ?? size / (TILES_PER_SIDE / MASTER_GAP_TO_TILE_RATIO + TILES_PER_SIDE - 1);
    const tilePixels = (size - gap * (TILES_PER_SIDE - 1)) / TILES_PER_SIDE;
    const cell = tilePixels / TILE_SIZE;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#c7cacf";
    ctx.fillRect(0, 0, size, size);

    for (let tileRow = 0; tileRow < TILES_PER_SIDE; tileRow++) {
      for (let tileCol = 0; tileCol < TILES_PER_SIDE; tileCol++) {
        const tileX = tileCol * (tilePixels + gap);
        const tileY = tileRow * (tilePixels + gap);
        for (let row = 0; row < TILE_SIZE; row++) {
          const masterRow = tileRow * TILE_SIZE + row;
          for (let col = 0; col < TILE_SIZE; col++) {
            const masterCol = tileCol * TILE_SIZE + col;
            const id = state.masterGrid[masterRow * MASTER_SIZE + masterCol];
            ctx.fillStyle = PALETTE[id - 1];
            ctx.fillRect(tileX + col * cell, tileY + row * cell, cell + 0.2, cell + 0.2);
          }
        }
        // Match the game's gallery thumbnails: keep the board boundary visible
        // without turning the gaps into a heavy dark grid.
        ctx.strokeStyle = "rgba(169,173,177,.88)";
        ctx.lineWidth = Math.max(1, size / 768 * 2);
        ctx.strokeRect(tileX + ctx.lineWidth / 2, tileY + ctx.lineWidth / 2, tilePixels - ctx.lineWidth, tilePixels - ctx.lineWidth);
      }
    }

    if (labels) {
      ctx.font = `900 ${18 * size / 768}px Consolas, monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      for (let tileIndex = 0; tileIndex < 16; tileIndex++) {
        const { row, col, number } = tileDetails(tileIndex);
        const x = col * (tilePixels + gap) + 7 * size / 768;
        const y = row * (tilePixels + gap) + 7 * size / 768;
        ctx.fillStyle = "rgba(17,19,22,.82)";
        ctx.fillRect(x, y, 34 * size / 768, 27 * size / 768);
        ctx.fillStyle = "#fff";
        ctx.fillText(String(number).padStart(2, "0"), x + 5 * size / 768, y + 4 * size / 768);
      }
    }

    if (active) {
      const current = tileDetails();
      const x = current.col * (tilePixels + gap);
      const y = current.row * (tilePixels + gap);
      ctx.strokeStyle = "#18d4d1";
      ctx.lineWidth = 7 * size / 768;
      ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, tilePixels - ctx.lineWidth, tilePixels - ctx.lineWidth);
      ctx.strokeStyle = "#ff2b91";
      ctx.lineWidth = 2 * size / 768;
      const inset = 8 * size / 768;
      ctx.strokeRect(x + inset, y + inset, tilePixels - inset * 2, tilePixels - inset * 2);
    }
  }

  function drawMaster() {
    drawMasterTiles(masterCtx, el.masterCanvas.width, { labels: true, active: true });
  }

  function syncGridCanvasResolution() {
    const rect = el.gridCanvas.getBoundingClientRect();
    if (!rect.width) return;
    const pixelRatio = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
    const target = Math.max(576, Math.round(rect.width * pixelRatio));
    if (el.gridCanvas.width === target && el.gridCanvas.height === target) return;
    el.gridCanvas.width = target;
    el.gridCanvas.height = target;
    drawGrid();
  }

  function updateTileNavigation() {
    const details = tileDetails();
    el.tileTitle.textContent = `${String(details.number).padStart(2, "0")}号画板 · R${details.row + 1}-C${details.col + 1}`;
    el.tileProgressText.textContent = `${state.currentPosition + 1} / 16`;
    el.tileProgressBar.style.width = `${(state.currentPosition + 1) / 16 * 100}%`;
    el.prevTileBtn.disabled = state.currentPosition === 0 || state.animating;
    el.nextTileBtn.disabled = state.currentPosition === 15 || state.animating;
    el.cellInfo.textContent = `画板 ${String(details.number).padStart(2, "0")} · R— C—`;
    renderCardStack();
  }

  function renderCardStack() {
    const remaining = TILE_ORDER.length - state.currentPosition - 1;
    const fragment = document.createDocumentFragment();
    const edgeColors = [
      "rgba(24, 212, 209, .86)", "rgba(17, 19, 22, .30)",
      "rgba(255, 43, 145, .72)", "rgba(17, 19, 22, .24)",
      "rgba(214, 232, 0, .86)"
    ];
    const paperColors = ["#f1f2f3", "#e8eaec", "#f5f5f4", "#e4e7e9"];
    for (let layer = remaining; layer >= 1; layer--) {
      const back = document.createElement("span");
      const pose = STACK_POSES[layer - 1];
      const spread = 5.2 + layer * 0.86;
      const offsetX = pose.x * spread + Math.sin(layer * 12.9898) * 1.4;
      const offsetY = pose.y * spread + Math.sin(layer * 78.233) * 1.4;
      const rotation = pose.r * (0.42 + layer * 0.055);
      back.className = "tile-card-back";
      back.style.zIndex = String(TILE_ORDER.length - layer);
      back.style.setProperty("--stack-x", `${offsetX.toFixed(2)}px`);
      back.style.setProperty("--stack-y", `${offsetY.toFixed(2)}px`);
      back.style.setProperty("--stack-rotate", `${rotation.toFixed(3)}deg`);
      back.style.setProperty("--stack-color", edgeColors[layer % edgeColors.length]);
      back.style.setProperty("--stack-paper", paperColors[layer % paperColors.length]);
      fragment.append(back);
    }
    el.tileCardBacks.replaceChildren(fragment);
    el.tileCardStack.classList.toggle("is-single", remaining === 0);
  }

  function waitForAnimation(duration = 330) {
    return new Promise(resolve => window.setTimeout(resolve, duration));
  }

  async function moveTile(delta) {
    const nextPosition = state.currentPosition + delta;
    if (state.animating || nextPosition < 0 || nextPosition >= TILE_ORDER.length) return;
    state.animating = true;
    writeCurrentTileToMaster();
    updateTileNavigation();
    if (delta > 0) {
      el.tileCard.classList.add("slide-out-left");
      await waitForAnimation(290);
      state.currentPosition = nextPosition;
      loadCurrentTile();
      el.tileCard.classList.remove("slide-out-left");
    } else {
      state.currentPosition = nextPosition;
      loadCurrentTile();
      el.tileCard.classList.add("slide-in-left");
      await waitForAnimation(330);
      el.tileCard.classList.remove("slide-in-left");
    }
    state.animating = false;
    updateTileNavigation();
    saveLocal();
  }

  async function jumpToTile(tileIndex) {
    const targetPosition = TILE_ORDER.indexOf(tileIndex);
    if (targetPosition < 0 || targetPosition === state.currentPosition || state.animating) return;
    const direction = targetPosition > state.currentPosition ? 1 : -1;
    state.animating = true;
    writeCurrentTileToMaster();
    if (direction > 0) {
      el.tileCard.classList.add("slide-out-left");
      await waitForAnimation(290);
      state.currentPosition = targetPosition;
      loadCurrentTile();
      el.tileCard.classList.remove("slide-out-left");
    } else {
      state.currentPosition = targetPosition;
      loadCurrentTile();
      el.tileCard.classList.add("slide-in-left");
      await waitForAnimation(330);
      el.tileCard.classList.remove("slide-in-left");
    }
    state.animating = false;
    updateTileNavigation();
    saveLocal();
  }

  function cellFromEvent(event) {
    const rect = el.gridCanvas.getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left) / rect.width * TILE_SIZE);
    const row = Math.floor((event.clientY - rect.top) / rect.height * TILE_SIZE);
    if (row < 0 || row >= TILE_SIZE || col < 0 || col >= TILE_SIZE) return null;
    return { row, col, index: row * TILE_SIZE + col };
  }

  function beginMutation() {
    if (!state.mutationBefore) state.mutationBefore = state.grid.slice();
  }

  function endMutation() {
    if (!state.mutationBefore) return;
    let changed = false;
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] !== state.mutationBefore[i]) { changed = true; break; }
    }
    if (changed) {
      state.undo.push(state.mutationBefore);
      if (state.undo.length > 80) state.undo.shift();
      state.redo = [];
      afterGridChange();
    }
    state.mutationBefore = null;
  }

  function afterGridChange() {
    writeCurrentTileToMaster();
    drawGrid();
    drawMaster();
    updatePaletteCounts();
    updateHistoryButtons();
    saveLocal();
  }

  function updateHistoryButtons() {
    el.undoBtn.disabled = state.undo.length === 0;
    el.redoBtn.disabled = state.redo.length === 0;
  }

  function undo() {
    if (!state.undo.length) return;
    state.redo.push(state.grid.slice());
    state.grid = state.undo.pop();
    afterGridChange();
  }

  function redo() {
    if (!state.redo.length) return;
    state.undo.push(state.grid.slice());
    state.grid = state.redo.pop();
    afterGridChange();
  }

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll(".tool[data-tool]").forEach(button => button.classList.toggle("active", button.dataset.tool === tool));
  }

  function paintCell(cell) {
    if (!cell || state.grid[cell.index] === state.selected) return;
    state.grid[cell.index] = state.selected;
    drawGrid();
  }

  function floodFill(startIndex, newId) {
    const oldId = state.grid[startIndex];
    if (oldId === newId) return;
    const stack = [startIndex];
    const seen = new Uint8Array(TILE_SIZE * TILE_SIZE);
    while (stack.length) {
      const index = stack.pop();
      if (seen[index] || state.grid[index] !== oldId) continue;
      seen[index] = 1;
      state.grid[index] = newId;
      const row = Math.floor(index / TILE_SIZE);
      const col = index % TILE_SIZE;
      if (row > 0) stack.push(index - TILE_SIZE);
      if (row < TILE_SIZE - 1) stack.push(index + TILE_SIZE);
      if (col > 0) stack.push(index - 1);
      if (col < TILE_SIZE - 1) stack.push(index + 1);
    }
  }

  function replaceColor() {
    const from = Number(el.replaceFrom.value);
    if (from === state.selected) return setStatus("来源色和当前色相同，不需要替换。", true);
    beginMutation();
    let count = 0;
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] === from) { state.grid[i] = state.selected; count++; }
    }
    endMutation();
    setStatus(count ? `已在当前画板将 ${String(from).padStart(2, "0")} 的 ${count} 格替换为 ${String(state.selected).padStart(2, "0")}。` : "当前画板没有这种来源色。 ");
  }

  function createMasterPixelCanvas(scale = 7) {
    writeCurrentTileToMaster();
    const canvas = document.createElement("canvas");
    const tilePixels = TILE_SIZE * scale;
    const exportGap = tilePixels * MASTER_GAP_TO_TILE_RATIO;
    canvas.width = MASTER_SIZE * scale + exportGap * (TILES_PER_SIDE - 1);
    canvas.height = canvas.width;
    const ctx = canvas.getContext("2d");
    drawMasterTiles(ctx, canvas.width, { gapPixels: exportGap });
    return canvas;
  }

  function createTileNumberCanvas(tileIndex) {
    const tileGrid = extractTile(tileIndex);
    const details = tileDetails(tileIndex);
    const cell = 44;
    const margin = 58;
    const board = margin * 2 + cell * TILE_SIZE;
    const legendWidth = 600;
    const canvas = document.createElement("canvas");
    canvas.width = board + legendWidth;
    canvas.height = board;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f6f6f3";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#202422";
    ctx.font = '700 18px "Microsoft YaHei UI", sans-serif';
    for (let index = 0; index < TILE_SIZE; index++) {
      ctx.fillText(String(index + 1), margin + (index + 0.5) * cell, margin / 2);
      ctx.fillText(String(index + 1), margin / 2, margin + (index + 0.5) * cell);
    }
    ctx.font = '700 16px "Microsoft YaHei UI", sans-serif';
    for (let row = 0; row < TILE_SIZE; row++) {
      for (let col = 0; col < TILE_SIZE; col++) {
        const id = tileGrid[row * TILE_SIZE + col];
        const x = margin + col * cell;
        const y = margin + row * cell;
        ctx.fillStyle = PALETTE[id - 1];
        ctx.fillRect(x, y, cell, cell);
        ctx.strokeStyle = "rgba(20,25,23,.72)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        ctx.fillStyle = colorText(RGB[id - 1]);
        ctx.strokeStyle = ctx.fillStyle === "#ffffff" ? "rgba(0,0,0,.85)" : "rgba(255,255,255,.86)";
        ctx.lineWidth = 2.5;
        const text = String(id).padStart(2, "0");
        ctx.strokeText(text, x + cell / 2, y + cell / 2 + 1);
        ctx.fillText(text, x + cell / 2, y + cell / 2 + 1);
      }
    }
    drawTileLegend(ctx, tileGrid, details, board, legendWidth, board);
    drawDrawingSignature(ctx, canvas);
    return canvas;
  }

  function drawTileLegend(ctx, tileGrid, details, left, width, height) {
    const counts = new Uint16Array(41);
    tileGrid.forEach(id => counts[id]++);
    ctx.fillStyle = "#f9f9f7";
    ctx.fillRect(left, 0, width, height);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#202422";
    ctx.font = '700 25px "Microsoft YaHei UI", sans-serif';
    ctx.fillText("奇象巡展·赛博拼豆制图工具", left + 22, 40);
    ctx.fillStyle = "#5e6864";
    ctx.font = '13px "Microsoft YaHei UI", sans-serif';
    ctx.fillText(`${String(details.number).padStart(2, "0")}号画板 · R${details.row + 1}-C${details.col + 1} · 固定40色`, left + 22, 67);
    const columns = 2;
    const rows = 20;
    const side = 22;
    const columnGap = 18;
    const startY = 92;
    const rowHeight = Math.floor((height - 146) / rows);
    const itemWidth = Math.floor((width - side * 2 - columnGap) / columns);
    const swatchWidth = 42;
    const swatchHeight = 34;
    for (let index = 0; index < 40; index++) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = left + side + column * (itemWidth + columnGap);
      const y = startY + row * rowHeight;
      ctx.fillStyle = PALETTE[index];
      ctx.fillRect(x, y, swatchWidth, swatchHeight);
      ctx.strokeStyle = "#737876";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, swatchWidth - 1, swatchHeight - 1);
      const centerY = y + swatchHeight / 2 + 0.5;
      const infoX = x + swatchWidth + 9;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#202422";
      ctx.font = '700 18px Consolas, monospace';
      ctx.fillText(String(index + 1).padStart(2, "0"), infoX, centerY);
      ctx.fillStyle = "#59615e";
      ctx.font = '12px Consolas, monospace';
      ctx.fillText(PALETTE[index], infoX + 33, centerY);
      ctx.font = '13px "Microsoft YaHei UI", sans-serif';
      ctx.fillText(`${counts[index + 1]}格`, infoX + 111, centerY);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#4b5551";
    ctx.font = '14px "Microsoft YaHei UI", sans-serif';
    ctx.fillText(`24 × 24，共576格；当前画板使用 ${new Set(tileGrid).size} 色`, left + 22, height - 28);
  }

  function drawDrawingSignature(ctx, canvas) {
    const unit = Math.min(canvas.width, canvas.height) / 1172;
    const bySize = Math.max(15, Math.round(18 * unit));
    const nameSize = Math.max(27, Math.round(34 * unit));
    const gap = Math.max(7, Math.round(9 * unit));
    const marginX = Math.max(22, Math.round(28 * unit));
    const marginY = Math.max(19, Math.round(24 * unit));
    ctx.save();
    ctx.fillStyle = "#e91e83";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${bySize}px "Arial Black", "Microsoft YaHei UI", sans-serif`;
    const byWidth = ctx.measureText("by").width;
    ctx.font = `700 italic ${nameSize}px "Segoe Script", "Segoe Print", "Comic Sans MS", cursive`;
    const nameWidth = ctx.measureText("Hanako").width;
    const x = canvas.width - byWidth - gap - nameWidth - marginX;
    const baseline = canvas.height - marginY;
    ctx.font = `700 ${bySize}px "Arial Black", "Microsoft YaHei UI", sans-serif`;
    ctx.fillText("by", x, baseline - Math.round(nameSize * 0.08));
    ctx.font = `700 italic ${nameSize}px "Segoe Script", "Segoe Print", "Comic Sans MS", cursive`;
    ctx.fillText("Hanako", x + byWidth + gap, baseline);
    ctx.restore();
  }

  function setAuthorFlipState(flipped) {
    el.authorFlipCard.classList.toggle("is-flipped", flipped);
    el.authorFlipCard.setAttribute("aria-pressed", String(flipped));
    el.authorFlipCard.setAttribute("aria-label", flipped
      ? "当前显示明日方舟主页，点击返回小红书主页"
      : "当前显示小红书主页，点击查看明日方舟主页");
  }

  async function flipAuthorCard() {
    if (el.authorFlipCard.dataset.animating === "true") return;
    const next = !el.authorFlipCard.classList.contains("is-flipped");
    const inner = el.authorFlipCard.querySelector(".author-flip-inner");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof inner.animate !== "function") {
      setAuthorFlipState(next);
      return;
    }
    el.authorFlipCard.dataset.animating = "true";
    try {
      const close = inner.animate([
        { transform: "translateZ(0) scaleX(1)" },
        { transform: "translateZ(0) scaleX(.015)" }
      ], { duration: 155, easing: "cubic-bezier(.55, .06, .68, .19)", fill: "forwards" });
      await close.finished;
      setAuthorFlipState(next);
      close.cancel();
      const open = inner.animate([
        { transform: "translateZ(0) scaleX(.015)" },
        { transform: "translateZ(0) scaleX(1)" }
      ], { duration: 205, easing: "cubic-bezier(.22, .61, .36, 1)", fill: "forwards" });
      await open.finished;
      open.cancel();
    } finally {
      delete el.authorFlipCard.dataset.animating;
    }
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("浏览器无法生成PNG"));
    }, "image/png"));
  }

  function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function zipDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function createStoredZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    const stamp = zipDateTime();
    let offset = 0;
    let centralSize = 0;
    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = file.data;
      const checksum = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034B50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, name.length, true);
      local.set(name, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014B50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);
      centralParts.push(central);
      centralSize += central.length;
      offset += local.length + data.length;
    }
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054B50, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  async function exportMosaicDrawings() {
    if (exportingDrawings) return;
    exportingDrawings = true;
    writeCurrentTileToMaster();
    const originalText = el.noticeConfirmBtn.textContent;
    el.noticeConfirmBtn.disabled = true;
    try {
      const files = [];
      for (let position = 0; position < TILE_ORDER.length; position++) {
        const tileIndex = TILE_ORDER[position];
        const details = tileDetails(tileIndex);
        el.noticeConfirmBtn.textContent = `正在生成 ${position + 1} / 16`;
        setStatus(`正在生成 ${String(details.number).padStart(2, "0")}号画板图纸（${position + 1}/16）…`);
        const canvas = createTileNumberCanvas(tileIndex);
        const blob = await canvasToPngBlob(canvas);
        files.push({
          name: `${String(details.number).padStart(2, "0")}_board_R${details.row + 1}-C${details.col + 1}.png`,
          data: new Uint8Array(await blob.arrayBuffer())
        });
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      const filename = `${safeName()}_96x96_16张图纸.zip`;
      downloadBlob(createStoredZip(files), filename);
      const historyPersisted = recordExportHistory();
      el.noticeDialog.close();
      setStatus(historyPersisted
        ? `已按16→01顺序导出16张带署名图纸，并加入大图历史：${filename}`
        : `已导出 ${filename}；当前浏览器禁止本地存储，历史只能保留到本页关闭前。`);
    } catch (error) {
      setStatus(`图纸导出失败：${error.message}`, true);
    } finally {
      exportingDrawings = false;
      el.noticeConfirmBtn.disabled = false;
      el.noticeConfirmBtn.textContent = originalText;
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadCanvas(canvas, filename) {
    canvas.toBlob(blob => {
      if (!blob) return setStatus("浏览器无法生成PNG，请换用Edge或Chrome。", true);
      downloadBlob(blob, filename);
      setStatus(`已导出大图预览：${filename}`);
    }, "image/png");
  }

  function createProjectData() {
    writeCurrentTileToMaster();
    return {
      format: PROJECT_FORMAT,
      version: 1,
      masterSize: MASTER_SIZE,
      tileSize: TILE_SIZE,
      tilesPerSide: TILES_PER_SIDE,
      palette: PALETTE,
      masterGrid: Array.from(state.masterGrid),
      currentPosition: state.currentPosition,
      selected: state.selected,
      fileName: safeName(),
      settings: {
        mode: el.modeSelect.value,
        contrast: Number(el.contrastRange.value),
        saturation: Number(el.saturationRange.value),
        showNumbers: el.showNumbers.checked,
        showGrid: el.showGrid.checked
      },
      savedAt: new Date().toISOString()
    };
  }

  function validateProject(project) {
    if (!project || project.format !== PROJECT_FORMAT || project.masterSize !== MASTER_SIZE || project.tileSize !== TILE_SIZE || !Array.isArray(project.masterGrid) || project.masterGrid.length !== MASTER_SIZE * MASTER_SIZE) {
      throw new Error("不是有效的96×96大图工程文件");
    }
    if (project.masterGrid.some(id => !Number.isInteger(id) || id < 1 || id > 40)) {
      throw new Error("工程中含有固定色板以外的编号");
    }
  }

  function applyProject(project) {
    validateProject(project);
    state.masterGrid = new Uint8Array(project.masterGrid);
    state.currentPosition = Math.max(0, Math.min(15, Number(project.currentPosition) || 0));
    if (project.fileName) el.fileName.value = String(project.fileName).slice(0, 40);
    if (project.settings) {
      if (["hybrid", "dominant", "average"].includes(project.settings.mode)) el.modeSelect.value = project.settings.mode;
      if (Number.isFinite(project.settings.contrast)) el.contrastRange.value = String(project.settings.contrast);
      if (Number.isFinite(project.settings.saturation)) el.saturationRange.value = String(project.settings.saturation);
      el.showNumbers.checked = project.settings.showNumbers !== false;
      el.showGrid.checked = project.settings.showGrid !== false;
    }
    if (project.selected) selectColor(project.selected);
    syncOutputs();
    loadCurrentTile();
    saveLocal();
  }

  function saveProject() {
    const project = createProjectData();
    const filename = `${safeName()}_96x96_大图工程.json`;
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" }), filename);
    setStatus(`大图工程已保存：${filename}`);
  }

  function loadProjectFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        applyProject(JSON.parse(String(reader.result)));
        setStatus("96×96大图工程已载入，可以从当前画板继续施工。 ");
      } catch (error) {
        setStatus(`载入失败：${error.message}`, true);
      } finally {
        el.projectInput.value = "";
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function historySignature(project) {
    return `${project.fileName}|${project.currentPosition}|${crc32(Uint8Array.from(project.masterGrid))}`;
  }

  function loadExportHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(EXPORT_HISTORY_KEY) || "[]");
      if (!Array.isArray(saved)) return;
      exportHistory = saved.filter(record => {
        try {
          validateProject(record?.project);
          return typeof record.id === "string" && typeof record.exportedAt === "string";
        } catch (_) {
          return false;
        }
      }).slice(0, EXPORT_HISTORY_LIMIT);
    } catch (_) {
      exportHistory = [];
    }
  }

  function persistExportHistory() {
    try {
      localStorage.setItem(EXPORT_HISTORY_KEY, JSON.stringify(exportHistory));
      return true;
    } catch (_) {
      return false;
    }
  }

  function drawHistoryThumbnail(canvas, grid) {
    canvas.width = MASTER_SIZE;
    canvas.height = MASTER_SIZE;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (let row = 0; row < MASTER_SIZE; row++) {
      for (let col = 0; col < MASTER_SIZE; col++) {
        ctx.fillStyle = PALETTE[grid[row * MASTER_SIZE + col] - 1];
        ctx.fillRect(col, row, 1, 1);
      }
    }
    ctx.fillStyle = "rgba(192, 196, 200, .94)";
    for (let index = 1; index < TILES_PER_SIDE; index++) {
      const at = index * TILE_SIZE;
      ctx.fillRect(at - 1, 0, 2, MASTER_SIZE);
      ctx.fillRect(0, at - 1, MASTER_SIZE, 2);
    }
  }

  function formatHistoryTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return date.toLocaleString("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    });
  }

  function loadHistoryRecord(record) {
    try {
      applyProject(record.project);
      setStatus(`已从大图历史载入“${record.project.fileName}”，可继续修改或导出。`);
      document.querySelector(".editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(`历史记录载入失败：${error.message}`, true);
    }
  }

  function removeHistoryRecord(id) {
    const record = exportHistory.find(item => item.id === id);
    if (!record || !window.confirm(`删除大图历史“${record.project.fileName}”？`)) return;
    exportHistory = exportHistory.filter(item => item.id !== id);
    persistExportHistory();
    renderExportHistory();
    setStatus("已删除一条大图导出历史。 ");
  }

  function renderExportHistory() {
    el.exportHistory.replaceChildren();
    el.historyCount.textContent = `${exportHistory.length} 份`;
    el.clearHistoryBtn.disabled = exportHistory.length === 0;
    if (!exportHistory.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "尚无记录。第一次导出大图图纸ZIP后会自动出现在这里。";
      el.exportHistory.append(empty);
      return;
    }

    exportHistory.forEach(record => {
      const card = document.createElement("article");
      card.className = "history-card";
      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className = "history-load";
      loadButton.setAttribute("aria-label", `载入大图历史 ${record.project.fileName}`);
      const canvas = document.createElement("canvas");
      canvas.className = "history-thumb";
      canvas.setAttribute("aria-hidden", "true");
      drawHistoryThumbnail(canvas, record.project.masterGrid);
      const copy = document.createElement("span");
      copy.className = "history-copy";
      const name = document.createElement("strong");
      name.textContent = record.project.fileName;
      const meta = document.createElement("span");
      meta.textContent = `${new Set(record.project.masterGrid).size} 色 · 96×96 · 进度 ${Number(record.project.currentPosition) + 1}/16`;
      const time = document.createElement("small");
      time.textContent = formatHistoryTime(record.exportedAt);
      copy.append(name, meta, time);
      loadButton.append(canvas, copy);
      loadButton.addEventListener("click", () => loadHistoryRecord(record));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "history-delete";
      deleteButton.textContent = "×";
      deleteButton.title = "删除这条记录";
      deleteButton.setAttribute("aria-label", `删除大图历史 ${record.project.fileName}`);
      deleteButton.addEventListener("click", () => removeHistoryRecord(record.id));
      card.append(loadButton, deleteButton);
      el.exportHistory.append(card);
    });
  }

  function recordExportHistory() {
    const exportedAt = new Date().toISOString();
    const project = createProjectData();
    project.savedAt = exportedAt;
    const signature = historySignature(project);
    const record = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      exportedAt,
      signature,
      project
    };
    exportHistory = [record, ...exportHistory.filter(item => (item.signature || historySignature(item.project)) !== signature)].slice(0, EXPORT_HISTORY_LIMIT);
    const persisted = persistExportHistory();
    renderExportHistory();
    return persisted;
  }

  function clearExportHistory() {
    if (!exportHistory.length || !window.confirm("清空全部大图导出历史？已下载的ZIP和JSON不会被删除。")) return;
    exportHistory = [];
    persistExportHistory();
    renderExportHistory();
    setStatus("大图导出历史已清空；已下载文件不受影响。 ");
  }

  function saveLocal() {
    try {
      writeCurrentTileToMaster();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        masterGrid: Array.from(state.masterGrid),
        currentPosition: state.currentPosition,
        fileName: el.fileName.value
      }));
    } catch (_) { /* local storage may be unavailable */ }
  }

  function restoreLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.masterGrid) && saved.masterGrid.length === MASTER_SIZE * MASTER_SIZE && saved.masterGrid.every(id => Number.isInteger(id) && id >= 1 && id <= 40)) {
        state.masterGrid = new Uint8Array(saved.masterGrid);
        state.currentPosition = Math.max(0, Math.min(15, Number(saved.currentPosition) || 0));
        if (saved.fileName) el.fileName.value = String(saved.fileName).slice(0, 40);
      }
    } catch (_) { /* ignore damaged cache */ }
  }

  function syncOutputs() {
    el.zoomOut.textContent = `${el.zoomRange.value}%`;
    el.contrastOut.textContent = Number(el.contrastRange.value) > 0 ? `+${el.contrastRange.value}` : el.contrastRange.value;
    el.saturationOut.textContent = Number(el.saturationRange.value) > 0 ? `+${el.saturationRange.value}` : el.saturationRange.value;
  }

  function showExportNotice() {
    if (!el.noticeDialog.open) el.noticeDialog.showModal();
  }

  function bindEvents() {
    el.imageInput.addEventListener("change", () => { loadImageFile(el.imageInput.files[0]); el.imageInput.value = ""; });
    el.projectInput.addEventListener("change", () => loadProjectFile(el.projectInput.files[0]));
    ["dragenter", "dragover"].forEach(type => el.dropZone.addEventListener(type, event => { event.preventDefault(); el.dropZone.classList.add("dragging"); }));
    ["dragleave", "drop"].forEach(type => el.dropZone.addEventListener(type, event => { event.preventDefault(); el.dropZone.classList.remove("dragging"); }));
    el.dropZone.addEventListener("drop", event => loadImageFile([...event.dataTransfer.files].find(file => file.type.startsWith("image/"))));
    document.addEventListener("paste", event => {
      const file = [...(event.clipboardData?.files || [])].find(item => item.type.startsWith("image/"));
      if (file) loadImageFile(file);
    });

    el.sourceCanvas.addEventListener("pointerdown", event => {
      state.cropDrag = { x: event.clientX, y: event.clientY, panX: state.panX, panY: state.panY };
      el.sourceCanvas.setPointerCapture(event.pointerId);
      el.sourceCanvas.classList.add("dragging");
    });
    el.sourceCanvas.addEventListener("pointermove", event => {
      if (!state.cropDrag) return;
      const rect = el.sourceCanvas.getBoundingClientRect();
      state.panX = state.cropDrag.panX + (event.clientX - state.cropDrag.x) * SOURCE_SIZE / rect.width;
      state.panY = state.cropDrag.panY + (event.clientY - state.cropDrag.y) * SOURCE_SIZE / rect.height;
      drawSource();
    });
    const stopCropDrag = () => { state.cropDrag = null; el.sourceCanvas.classList.remove("dragging"); };
    el.sourceCanvas.addEventListener("pointerup", stopCropDrag);
    el.sourceCanvas.addEventListener("pointercancel", stopCropDrag);
    el.sourceCanvas.addEventListener("wheel", event => {
      event.preventDefault();
      const next = Math.max(100, Math.min(400, Number(el.zoomRange.value) + (event.deltaY < 0 ? 10 : -10)));
      el.zoomRange.value = String(next);
      state.zoom = next / 100;
      syncOutputs();
      drawSource();
    }, { passive: false });

    el.zoomRange.addEventListener("input", () => { state.zoom = Number(el.zoomRange.value) / 100; syncOutputs(); drawSource(); });
    el.contrastRange.addEventListener("input", syncOutputs);
    el.saturationRange.addEventListener("input", syncOutputs);
    el.resetCropBtn.addEventListener("click", () => resetCrop(false));
    el.fitSubjectBtn.addEventListener("click", () => resetCrop(!state.fitFull));
    el.removeImageBtn.addEventListener("click", event => { event.stopPropagation(); removeSourceImage(); });
    el.generateBtn.addEventListener("click", buildMasterFromImage);

    document.querySelectorAll(".tool[data-tool]").forEach(button => button.addEventListener("click", () => setTool(button.dataset.tool)));
    el.undoBtn.addEventListener("click", undo);
    el.redoBtn.addEventListener("click", redo);
    el.showNumbers.addEventListener("change", drawGrid);
    el.showGrid.addEventListener("change", drawGrid);
    el.replaceBtn.addEventListener("click", replaceColor);
    el.prevTileBtn.addEventListener("click", () => moveTile(-1));
    el.nextTileBtn.addEventListener("click", () => moveTile(1));

    el.masterCanvas.addEventListener("click", event => {
      const rect = el.masterCanvas.getBoundingClientRect();
      const col = Math.max(0, Math.min(3, Math.floor((event.clientX - rect.left) / rect.width * 4)));
      const row = Math.max(0, Math.min(3, Math.floor((event.clientY - rect.top) / rect.height * 4)));
      jumpToTile(row * 4 + col);
    });

    el.gridCanvas.addEventListener("pointerdown", event => {
      const cell = cellFromEvent(event);
      if (!cell) return;
      el.gridCanvas.setPointerCapture(event.pointerId);
      if (event.button === 2 || state.tool === "picker") {
        selectColor(state.grid[cell.index]);
        setStatus(`已从画板${String(tileDetails().number).padStart(2, "0")}的 R${cell.row + 1} C${cell.col + 1} 取得颜色 ${String(state.selected).padStart(2, "0")}。`);
        return;
      }
      beginMutation();
      if (state.tool === "fill") {
        floodFill(cell.index, state.selected);
        endMutation();
      } else {
        state.painting = true;
        paintCell(cell);
      }
    });
    el.gridCanvas.addEventListener("pointermove", event => {
      const cell = cellFromEvent(event);
      if (cell) el.cellInfo.textContent = `画板 ${String(tileDetails().number).padStart(2, "0")} · R${cell.row + 1} C${cell.col + 1} · ${String(state.grid[cell.index]).padStart(2, "0")}`;
      if (state.painting && state.tool === "paint") paintCell(cell);
    });
    el.gridCanvas.addEventListener("pointerleave", () => {
      if (!state.painting) el.cellInfo.textContent = `画板 ${String(tileDetails().number).padStart(2, "0")} · R— C—`;
    });
    const stopPainting = () => { if (state.painting) { state.painting = false; endMutation(); } };
    el.gridCanvas.addEventListener("pointerup", stopPainting);
    el.gridCanvas.addEventListener("pointercancel", stopPainting);
    window.addEventListener("pointerup", stopPainting);
    el.gridCanvas.addEventListener("contextmenu", event => event.preventDefault());

    document.addEventListener("keydown", event => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
      if (event.key.toLowerCase() === "b") setTool("paint");
      if (event.key.toLowerCase() === "f") setTool("fill");
      if (event.key.toLowerCase() === "i") setTool("picker");
      if (event.key === "ArrowRight") moveTile(1);
      if (event.key === "ArrowLeft") moveTile(-1);
    });

    el.fileName.addEventListener("change", saveLocal);
    el.helpBtn.addEventListener("click", () => {
      el.helpPanel.hidden = !el.helpPanel.hidden;
      el.helpBtn.setAttribute("aria-expanded", String(!el.helpPanel.hidden));
    });
    el.authorLinks.forEach(link => link.addEventListener("click", event => {
      event.preventDefault();
      setAuthorFlipState(false);
      if (!el.authorDialog.open) el.authorDialog.showModal();
    }));
    el.authorCloseBtn.addEventListener("click", () => el.authorDialog.close());
    el.authorFlipCard.addEventListener("click", flipAuthorCard);
    el.authorDialog.addEventListener("click", event => { if (event.target === el.authorDialog) el.authorDialog.close(); });
    el.noticeCloseBtn.addEventListener("click", () => el.noticeDialog.close());
    el.noticeConfirmBtn.addEventListener("click", exportMosaicDrawings);
    el.noticeDialog.addEventListener("click", event => { if (event.target === el.noticeDialog) el.noticeDialog.close(); });
    el.clearHistoryBtn.addEventListener("click", clearExportHistory);
    el.saveProjectBtn.addEventListener("click", saveProject);
    el.exportPreviewBtn.addEventListener("click", () => downloadCanvas(createMasterPixelCanvas(7), `${safeName()}_96x96_PNG预览.png`));
    el.exportTotalBtn.addEventListener("click", showExportNotice);
  }

  function init() {
    restoreLocal();
    loadExportHistory();
    renderPalette();
    renderExportHistory();
    renderCoordinateAxes();
    bindEvents();
    syncOutputs();
    loadCurrentTile();
    if ("ResizeObserver" in window) {
      gridResizeObserver = new ResizeObserver(syncGridCanvasResolution);
      gridResizeObserver.observe(el.gridCanvas);
    }
    window.addEventListener("resize", syncGridCanvasResolution);
    window.addEventListener("beforeunload", saveLocal);
    window.requestAnimationFrame(syncGridCanvasResolution);
  }

  init();
})();
