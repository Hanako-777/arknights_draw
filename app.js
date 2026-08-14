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
  const RGB = PALETTE.map(hexToRgb);
  const PALETTE_LAB = RGB.map(([r, g, b]) => rgbToOklab(r, g, b));
  const PALETTE_CHROMA = PALETTE_LAB.map(([, a, b]) => Math.hypot(a, b));
  const DARK_IDS = [1, 26, 28, 29, 40];
  const GRID = 24;
  const SOURCE_SIZE = 560;
  const DEFAULT_DARK_THRESHOLD = 18;
  const DEFAULT_DOMINANT_THRESHOLD = 36;
  const PREVIEW_INTERVAL = 90;
  const WHEEL_FINAL_DELAY = 140;
  const STORAGE_KEY = "arknights_draw-local-grid-v2";
  const EXPORT_HISTORY_KEY = "arknights_draw-export-history-v2";
  const EXPORT_HISTORY_LIMIT = 50;

  const $ = id => document.getElementById(id);
  const el = {
    imageInput: $("imageInput"), projectInput: $("projectInput"), dropZone: $("dropZone"),
    sourcePreviews: $("sourcePreviews"), cropWrap: $("cropWrap"), sourceCanvas: $("sourceCanvas"),
    pixelPreviewCanvas: $("pixelPreviewCanvas"), sourceMeta: $("sourceMeta"),
    removeImageBtn: $("removeImageBtn"),
    zoomRange: $("zoomRange"), zoomOut: $("zoomOut"), resetCropBtn: $("resetCropBtn"),
    fitSubjectBtn: $("fitSubjectBtn"), resetParamsBtn: $("resetParamsBtn"), modeSelect: $("modeSelect"),
    contrastRange: $("contrastRange"), contrastOut: $("contrastOut"),
    saturationRange: $("saturationRange"), saturationOut: $("saturationOut"),
    hybridThresholds: $("hybridThresholds"),
    darkThresholdRange: $("darkThresholdRange"), darkThresholdOut: $("darkThresholdOut"),
    dominantThresholdRange: $("dominantThresholdRange"), dominantThresholdOut: $("dominantThresholdOut"),
    generateBtn: $("generateBtn"), gridCanvas: $("gridCanvas"), overviewCanvas: $("overviewCanvas"),
    cellInfo: $("cellInfo"),
    undoBtn: $("undoBtn"), redoBtn: $("redoBtn"), showNumbers: $("showNumbers"),
    showGrid: $("showGrid"), showOverview: $("showOverview"), overviewCard: $("overviewCard"),
    editorBoardLayout: $("editorBoardLayout"), replaceFrom: $("replaceFrom"), replaceBtn: $("replaceBtn"),
    blockToolbar: $("blockToolbar"), selectAllBtn: $("selectAllBtn"), clearSelectionBtn: $("clearSelectionBtn"),
    selectionCount: $("selectionCount"), colorSelectionBtn: $("colorSelectionBtn"),
    showSelectionMask: $("showSelectionMask"), showSelectionBorder: $("showSelectionBorder"),
    moveIdleControls: $("moveIdleControls"), moveActiveControls: $("moveActiveControls"),
    moveStartBtn: $("moveStartBtn"), moveConfirmBtn: $("moveConfirmBtn"), moveCancelBtn: $("moveCancelBtn"),
    selectedBadge: $("selectedBadge"), palette: $("palette"), fileName: $("fileName"),
    saveProjectBtn: $("saveProjectBtn"), helpBtn: $("helpBtn"), helpPanel: $("helpPanel"),
    status: $("status"), boundaryNotice: $("boundaryNotice"),
    boundaryNoticeTitle: $("boundaryNoticeTitle"), boundaryNoticeText: $("boundaryNoticeText"),
    exportPngCard: $("exportPngCard"), exportPreviewBtn: $("exportPreviewBtn"),
    pngModeToggle: $("pngModeToggle"), pngModeLabel: $("pngModeLabel"),
    pngPreviewDescription: $("pngPreviewDescription"), pngRawDescription: $("pngRawDescription"),
    exportTotalBtn: $("exportTotalBtn"), exportHistory: $("exportHistory"),
    historyCount: $("historyCount"), clearHistoryBtn: $("clearHistoryBtn"),
    authorLinks: Array.from(document.querySelectorAll("[data-author-dialog]")), authorDialog: $("authorDialog"),
    authorCloseBtn: $("authorCloseBtn"), authorFlipCard: $("authorFlipCard")
  };

  const state = {
    image: null,
    imageUrl: "",
    zoom: 1,
    panX: 0,
    panY: 0,
    fitFull: false,
    cropDrag: null,
    grid: new Uint8Array(GRID * GRID).fill(4),
    selected: 1,
    tool: "paint",
    pngExportMode: "preview",
    painting: false,
    selection: new Uint8Array(GRID * GRID),
    selectionOperation: "add",
    selectionMethod: "brush",
    selectionDrag: null,
    selectionLastCell: null,
    moveSession: null,
    mutationBefore: null,
    mutationSelectionBefore: null,
    undo: [],
    redo: []
  };

  const sourceCtx = el.sourceCanvas.getContext("2d", { willReadFrequently: true });
  const pixelPreviewCtx = el.pixelPreviewCanvas.getContext("2d");
  const gridCtx = el.gridCanvas.getContext("2d");
  const overviewCtx = el.overviewCanvas.getContext("2d");
  let gridResizeObserver = null;
  let exportHistory = [];
  let boundaryNoticeTimer = 0;
  let previewFrame = 0;
  let previewTimer = 0;
  let previewLastRun = -Infinity;
  let previewRevision = 0;
  let previewRenderedRevision = -1;
  let wheelFinalTimer = 0;

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
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
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

  function showBoundaryNotice(direction) {
    window.clearTimeout(boundaryNoticeTimer);
    el.boundaryNoticeTitle.textContent = `无法向${direction}移动`;
    el.boundaryNoticeText.textContent = "区块已到达画板边缘，该操作无法执行。";
    el.boundaryNotice.hidden = false;
    el.boundaryNotice.classList.remove("visible");
    void el.boundaryNotice.offsetWidth;
    el.boundaryNotice.classList.add("visible");
    boundaryNoticeTimer = window.setTimeout(() => {
      el.boundaryNotice.classList.remove("visible");
      window.setTimeout(() => { el.boundaryNotice.hidden = true; }, 180);
    }, 2600);
  }

  function safeName() {
    const cleaned = (el.fileName.value || "arknights_draw").trim().replace(/[\\/:*?"<>|]+/g, "_");
    return cleaned || "arknights_draw";
  }

  function drawingName(value) {
    return String(value || "arknights_draw").replace(/\u65bd\u5de5\u56fe/g, "图纸");
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
      for (let value = 1; value <= GRID; value++) {
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
    const rgb = RGB[state.selected - 1];
    el.selectedBadge.textContent = `当前色 ${String(state.selected).padStart(2, "0")}`;
    el.selectedBadge.style.background = PALETTE[state.selected - 1];
    el.selectedBadge.style.color = colorText(rgb);
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
    const t = getImageTransform(width, height);
    if (t) ctx.drawImage(state.image, t.x, t.y, t.width, t.height);
    ctx.restore();
  }

  function drawSource() {
    sourceCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    drawImageTo(sourceCtx, SOURCE_SIZE, SOURCE_SIZE);
    schedulePixelPreview();
  }

  function analyzeImageGrid() {
    const block = 8;
    const sampleSize = GRID * block;
    const sample = document.createElement("canvas");
    sample.width = sampleSize;
    sample.height = sampleSize;
    const ctx = sample.getContext("2d", { willReadFrequently: true });
    drawImageTo(ctx, sampleSize, sampleSize);
    const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
    const result = new Uint8Array(GRID * GRID);
    const mode = el.modeSelect.value;
    const darkThreshold = (100 - Number(el.darkThresholdRange.value)) / 100;
    const dominantThreshold = (100 - Number(el.dominantThresholdRange.value)) / 100;

    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const counts = new Uint16Array(41);
        let sumR = 0, sumG = 0, sumB = 0;
        for (let y = 0; y < block; y++) {
          for (let x = 0; x < block; x++) {
            const pixel = ((row * block + y) * sampleSize + col * block + x) * 4;
            const adjusted = adjustedRgb(data[pixel], data[pixel + 1], data[pixel + 2]);
            sumR += adjusted[0]; sumG += adjusted[1]; sumB += adjusted[2];
            counts[nearestPaletteId(adjusted[0], adjusted[1], adjusted[2])]++;
          }
        }
        const total = block * block;
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
          if (darkTotal > 0 && darkTotal / total >= darkThreshold) chosen = darkId;
          else if (counts[dominantId] / total >= dominantThreshold) chosen = dominantId;
        }
        result[row * GRID + col] = chosen;
      }
    }
    return result;
  }

  function drawPixelPreview(result) {
    const size = el.pixelPreviewCanvas.width;
    const cell = size / GRID;
    pixelPreviewCtx.imageSmoothingEnabled = false;
    pixelPreviewCtx.clearRect(0, 0, size, size);
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        pixelPreviewCtx.fillStyle = PALETTE[result[row * GRID + col] - 1];
        pixelPreviewCtx.fillRect(col * cell, row * cell, cell, cell);
      }
    }
  }

  function cancelScheduledPixelPreview() {
    if (previewFrame) window.cancelAnimationFrame(previewFrame);
    if (previewTimer) window.clearTimeout(previewTimer);
    previewFrame = 0;
    previewTimer = 0;
  }

  function renderPixelPreview() {
    previewFrame = 0;
    previewTimer = 0;
    if (!state.image || previewRenderedRevision === previewRevision) return;
    const revision = previewRevision;
    previewLastRun = performance.now();
    drawPixelPreview(analyzeImageGrid());
    previewRenderedRevision = revision;
  }

  function schedulePixelPreview() {
    if (!state.image) return;
    previewRevision++;
    if (previewFrame || previewTimer) return;
    const remaining = PREVIEW_INTERVAL - (performance.now() - previewLastRun);
    if (remaining <= 0) {
      previewFrame = window.requestAnimationFrame(renderPixelPreview);
    } else {
      previewTimer = window.setTimeout(() => {
        previewTimer = 0;
        previewFrame = window.requestAnimationFrame(renderPixelPreview);
      }, remaining);
    }
  }

  function forcePixelPreview() {
    if (!state.image || previewRenderedRevision === previewRevision) return;
    cancelScheduledPixelPreview();
    renderPixelPreview();
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
      el.fileName.value = file.name.replace(/\.[^.]+$/, "") || "arknights_draw";
      el.sourceMeta.textContent = `${image.width} × ${image.height}`;
      el.dropZone.hidden = true;
      el.sourcePreviews.hidden = false;
      el.generateBtn.disabled = false;
      resetCrop(false);
      setStatus("图片已载入。拖动和缩放确定构图，然后生成初稿。 ");
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      setStatus("图片读取失败，请换一种图片格式。", true);
    };
    image.src = url;
  }

  function removeSourceImage() {
    cancelScheduledPixelPreview();
    if (wheelFinalTimer) window.clearTimeout(wheelFinalTimer);
    wheelFinalTimer = 0;
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
    el.sourcePreviews.hidden = true;
    el.dropZone.hidden = false;
    el.generateBtn.disabled = true;
    el.zoomRange.value = "100";
    syncOutputs();
    sourceCtx.clearRect(0, 0, SOURCE_SIZE, SOURCE_SIZE);
    pixelPreviewCtx.clearRect(0, 0, el.pixelPreviewCanvas.width, el.pixelPreviewCanvas.height);
    setStatus("已移除原图，可以上传新图片；当前24×24编辑结果已保留。 ");
  }

  function buildGridFromImage() {
    if (!state.image) return;
    setStatus("正在分析576个方格并匹配固定40色……");
    el.generateBtn.disabled = true;
    window.setTimeout(() => {
      try {
        const result = analyzeImageGrid();
        commitGrid(result);
        setStatus(`初稿已生成，共使用 ${new Set(result).size} 种固定色。现在可以逐格修正。`);
      } catch (error) {
        console.error(error);
        setStatus(`转换失败：${error.message}`, true);
      } finally {
        el.generateBtn.disabled = false;
      }
    }, 30);
  }

  function buildMoveResult(session = state.moveSession) {
    if (!session) return { grid: state.grid, selection: state.selection };
    const grid = session.grid.slice();
    const selection = new Uint8Array(GRID * GRID);
    for (let index = 0; index < session.selection.length; index++) {
      if (session.selection[index]) grid[index] = 4;
    }
    for (let index = 0; index < session.selection.length; index++) {
      if (!session.selection[index]) continue;
      const row = Math.floor(index / GRID) + session.rowOffset;
      const col = index % GRID + session.colOffset;
      const destination = row * GRID + col;
      grid[destination] = session.grid[index];
      selection[destination] = 1;
    }
    return { grid, selection };
  }

  function drawGrid() {
    const size = el.gridCanvas.width;
    const cell = size / GRID;
    const cssWidth = el.gridCanvas.getBoundingClientRect().width || size;
    const backingScale = size / cssWidth;
    const display = buildMoveResult();
    gridCtx.clearRect(0, 0, size, size);
    gridCtx.imageSmoothingEnabled = false;
    gridCtx.textAlign = "center";
    gridCtx.textBaseline = "middle";
    gridCtx.font = `900 ${cell * 0.48}px Consolas, "Cascadia Mono", monospace`;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const id = display.grid[row * GRID + col];
        gridCtx.fillStyle = PALETTE[id - 1];
        gridCtx.fillRect(col * cell, row * cell, cell + 0.2, cell + 0.2);
        if (el.showNumbers.checked) {
          const rgb = RGB[id - 1];
          const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
          gridCtx.fillStyle = luminance < 142 ? "#ffffff" : "#050505";
          const text = String(id).padStart(2, "0");
          gridCtx.fillText(text, (col + 0.5) * cell, (row + 0.52) * cell);
        }
      }
    }
    if (el.showGrid.checked) {
      gridCtx.beginPath();
      for (let i = 0; i <= GRID; i++) {
        const p = Math.round(i * cell) + 0.5;
        gridCtx.moveTo(p, 0); gridCtx.lineTo(p, size);
        gridCtx.moveTo(0, p); gridCtx.lineTo(size, p);
      }
      gridCtx.strokeStyle = "rgba(20,25,23,.48)";
      gridCtx.lineWidth = Math.max(1, backingScale);
      gridCtx.stroke();
    }
    if (state.tool === "block") drawSelection(cell, backingScale, display.selection);
    drawOverview(display.grid);
  }

  function drawSelection(cell, backingScale, selection = state.selection) {
    gridCtx.save();
    if (el.showSelectionMask.checked) {
      gridCtx.fillStyle = "rgba(24, 212, 209, .25)";
      for (let index = 0; index < selection.length; index++) {
        if (!selection[index]) continue;
        const row = Math.floor(index / GRID), col = index % GRID;
        gridCtx.fillRect(col * cell, row * cell, cell, cell);
      }
    }

    if (el.showSelectionBorder.checked) {
      gridCtx.beginPath();
      for (let index = 0; index < selection.length; index++) {
        if (!selection[index]) continue;
        const row = Math.floor(index / GRID), col = index % GRID;
        const x = col * cell, y = row * cell;
        if (row === 0 || !selection[index - GRID]) { gridCtx.moveTo(x, y); gridCtx.lineTo(x + cell, y); }
        if (row === GRID - 1 || !selection[index + GRID]) { gridCtx.moveTo(x, y + cell); gridCtx.lineTo(x + cell, y + cell); }
        if (col === 0 || !selection[index - 1]) { gridCtx.moveTo(x, y); gridCtx.lineTo(x, y + cell); }
        if (col === GRID - 1 || !selection[index + 1]) { gridCtx.moveTo(x + cell, y); gridCtx.lineTo(x + cell, y + cell); }
      }
      gridCtx.strokeStyle = "#ff2b91";
      gridCtx.lineWidth = Math.max(2, backingScale * 2);
      gridCtx.lineJoin = "miter";
      gridCtx.stroke();
    }

    if (state.selectionDrag?.method === "rect") {
      const { start, current } = state.selectionDrag;
      const left = Math.min(start.col, current.col) * cell;
      const top = Math.min(start.row, current.row) * cell;
      const width = (Math.abs(start.col - current.col) + 1) * cell;
      const height = (Math.abs(start.row - current.row) + 1) * cell;
      gridCtx.setLineDash([Math.max(5, cell * .2), Math.max(3, cell * .12)]);
      gridCtx.strokeStyle = state.selectionOperation === "add" ? "#050505" : "#ffffff";
      gridCtx.lineWidth = Math.max(2, backingScale * 2);
      gridCtx.strokeRect(left + gridCtx.lineWidth / 2, top + gridCtx.lineWidth / 2,
        Math.max(0, width - gridCtx.lineWidth), Math.max(0, height - gridCtx.lineWidth));
    }
    gridCtx.restore();
  }

  function drawOverview(grid = state.grid) {
    const size = el.overviewCanvas.width;
    const cell = size / GRID;
    overviewCtx.clearRect(0, 0, size, size);
    overviewCtx.imageSmoothingEnabled = false;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const id = grid[row * GRID + col];
        overviewCtx.fillStyle = PALETTE[id - 1];
        overviewCtx.fillRect(col * cell, row * cell, cell, cell);
      }
    }
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

  function cellFromEvent(event) {
    const rect = el.gridCanvas.getBoundingClientRect();
    const col = Math.floor((event.clientX - rect.left) / rect.width * GRID);
    const row = Math.floor((event.clientY - rect.top) / rect.height * GRID);
    if (row < 0 || row >= GRID || col < 0 || col >= GRID) return null;
    return { row, col, index: row * GRID + col };
  }

  function clampedCellFromEvent(event) {
    const rect = el.gridCanvas.getBoundingClientRect();
    const col = Math.max(0, Math.min(GRID - 1, Math.floor((event.clientX - rect.left) / rect.width * GRID)));
    const row = Math.max(0, Math.min(GRID - 1, Math.floor((event.clientY - rect.top) / rect.height * GRID)));
    return { row, col, index: row * GRID + col };
  }

  function selectionValue() {
    return state.selectionOperation === "add" ? 1 : 0;
  }

  function selectionSize() {
    let count = 0;
    state.selection.forEach(value => { if (value) count++; });
    return count;
  }

  function afterSelectionChange(redraw = true) {
    const count = selectionSize();
    el.selectionCount.textContent = `已选 ${count} 格`;
    el.clearSelectionBtn.disabled = count === 0;
    el.colorSelectionBtn.disabled = count === 0;
    el.moveStartBtn.disabled = count === 0;
    if (redraw) drawGrid();
  }

  function clearSelection(redraw = true) {
    if (state.moveSession) finishMoveSession({ silent: true });
    state.selection.fill(0);
    state.selectionDrag = null;
    state.selectionLastCell = null;
    afterSelectionChange(redraw);
  }

  function setSelectionOperation(operation) {
    if (state.moveSession) finishMoveSession({ silent: true });
    state.selectionOperation = operation === "subtract" ? "subtract" : "add";
    document.querySelectorAll("[data-selection-operation]").forEach(button => {
      const active = button.dataset.selectionOperation === state.selectionOperation;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    drawGrid();
  }

  function setSelectionMethod(method) {
    if (state.moveSession) finishMoveSession({ silent: true });
    state.selectionMethod = ["brush", "fill", "rect"].includes(method) ? method : "brush";
    state.selectionDrag = null;
    state.selectionLastCell = null;
    document.querySelectorAll("[data-selection-method]").forEach(button => {
      const active = button.dataset.selectionMethod === state.selectionMethod;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    drawGrid();
  }

  function applySelectionCell(cell) {
    if (!cell) return false;
    const value = selectionValue();
    if (state.selection[cell.index] === value) return false;
    state.selection[cell.index] = value;
    return true;
  }

  function applySelectionLine(from, to) {
    if (!from || !to) return;
    let x0 = from.col, y0 = from.row;
    const x1 = to.col, y1 = to.row;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      applySelectionCell({ row: y0, col: x0, index: y0 * GRID + x0 });
      if (x0 === x1 && y0 === y1) break;
      const twice = 2 * error;
      if (twice >= dy) { error += dy; x0 += sx; }
      if (twice <= dx) { error += dx; y0 += sy; }
    }
    afterSelectionChange();
  }

  function selectConnectedRegion(startIndex) {
    const color = state.grid[startIndex];
    const value = selectionValue();
    const stack = [startIndex];
    const seen = new Uint8Array(GRID * GRID);
    while (stack.length) {
      const index = stack.pop();
      if (seen[index] || state.grid[index] !== color) continue;
      seen[index] = 1;
      state.selection[index] = value;
      const row = Math.floor(index / GRID), col = index % GRID;
      if (row > 0) stack.push(index - GRID);
      if (row < GRID - 1) stack.push(index + GRID);
      if (col > 0) stack.push(index - 1);
      if (col < GRID - 1) stack.push(index + 1);
    }
    afterSelectionChange();
  }

  function applyRectangleSelection(start, end) {
    const top = Math.min(start.row, end.row), bottom = Math.max(start.row, end.row);
    const left = Math.min(start.col, end.col), right = Math.max(start.col, end.col);
    const value = selectionValue();
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) state.selection[row * GRID + col] = value;
    }
    afterSelectionChange();
  }

  function beginMutation(trackSelection = false) {
    if (!state.mutationBefore) {
      state.mutationBefore = state.grid.slice();
      state.mutationSelectionBefore = trackSelection ? state.selection.slice() : null;
    }
  }

  function endMutation() {
    if (!state.mutationBefore) return;
    let changed = false;
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] !== state.mutationBefore[i]) { changed = true; break; }
    }
    if (changed) {
      state.undo.push({ grid: state.mutationBefore, selection: state.mutationSelectionBefore });
      if (state.undo.length > 80) state.undo.shift();
      state.redo = [];
      afterGridChange();
    }
    state.mutationBefore = null;
    state.mutationSelectionBefore = null;
  }

  function commitGrid(next) {
    clearSelection(false);
    state.undo.push({ grid: state.grid.slice(), selection: null });
    if (state.undo.length > 80) state.undo.shift();
    state.grid = new Uint8Array(next);
    state.redo = [];
    afterGridChange();
  }

  function afterGridChange() {
    drawGrid();
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
    const entry = state.undo.pop();
    state.redo.push({ grid: state.grid.slice(), selection: entry.selection ? state.selection.slice() : null });
    state.grid = entry.grid;
    if (entry.selection) {
      state.selection = entry.selection;
      afterSelectionChange(false);
    }
    afterGridChange();
    setStatus("已撤销上一步。 ");
  }

  function redo() {
    if (!state.redo.length) return;
    const entry = state.redo.pop();
    state.undo.push({ grid: state.grid.slice(), selection: entry.selection ? state.selection.slice() : null });
    state.grid = entry.grid;
    if (entry.selection) {
      state.selection = entry.selection;
      afterSelectionChange(false);
    }
    afterGridChange();
    setStatus("已恢复上一步。 ");
  }

  function paintCell(cell) {
    if (!cell || state.grid[cell.index] === state.selected) return;
    state.grid[cell.index] = state.selected;
    drawGrid();
    updatePaletteCounts();
  }

  function floodFill(startIndex, newId) {
    const oldId = state.grid[startIndex];
    if (oldId === newId) return;
    const stack = [startIndex];
    const seen = new Uint8Array(GRID * GRID);
    while (stack.length) {
      const index = stack.pop();
      if (seen[index] || state.grid[index] !== oldId) continue;
      seen[index] = 1;
      state.grid[index] = newId;
      const row = Math.floor(index / GRID), col = index % GRID;
      if (row > 0) stack.push(index - GRID);
      if (row < GRID - 1) stack.push(index + GRID);
      if (col > 0) stack.push(index - 1);
      if (col < GRID - 1) stack.push(index + 1);
    }
  }

  function setTool(tool) {
    if (state.moveSession) finishMoveSession({ silent: true });
    if (state.painting) {
      state.painting = false;
      endMutation();
    }
    state.tool = tool;
    state.selectionDrag = null;
    state.selectionLastCell = null;
    document.querySelectorAll(".tool[data-tool]").forEach(button => button.classList.toggle("active", button.dataset.tool === tool));
    el.blockToolbar.hidden = tool !== "block";
    el.gridCanvas.classList.toggle("block-mode", tool === "block");
    drawGrid();
  }

  function colorSelection() {
    if (state.moveSession) finishMoveSession({ silent: true });
    const count = selectionSize();
    if (!count) return;
    beginMutation();
    let changed = 0;
    for (let index = 0; index < state.grid.length; index++) {
      if (state.selection[index] && state.grid[index] !== state.selected) {
        state.grid[index] = state.selected;
        changed++;
      }
    }
    endMutation();
    setStatus(changed
      ? `已将选中的 ${count} 格统一上色为 ${String(state.selected).padStart(2, "0")}。`
      : `选中的 ${count} 格已经是当前颜色。`);
  }

  function moveLimits(selection) {
    let minRow = GRID, maxRow = -1, minCol = GRID, maxCol = -1;
    for (let index = 0; index < selection.length; index++) {
      if (!selection[index]) continue;
      const row = Math.floor(index / GRID), col = index % GRID;
      minRow = Math.min(minRow, row); maxRow = Math.max(maxRow, row);
      minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    }
    return {
      minRowOffset: -minRow,
      maxRowOffset: GRID - 1 - maxRow,
      minColOffset: -minCol,
      maxColOffset: GRID - 1 - maxCol
    };
  }

  function syncMoveControls() {
    const active = Boolean(state.moveSession);
    el.moveIdleControls.hidden = active;
    el.moveActiveControls.hidden = !active;
    el.gridCanvas.classList.toggle("move-mode", active);
    if (!active) el.gridCanvas.classList.remove("move-dragging");
  }

  function startMoveSession() {
    if (state.moveSession || !selectionSize()) return;
    state.selectionDrag = null;
    state.selectionLastCell = null;
    state.moveSession = {
      grid: state.grid.slice(),
      selection: state.selection.slice(),
      rowOffset: 0,
      colOffset: 0,
      limits: moveLimits(state.selection),
      drag: null
    };
    syncMoveControls();
    drawGrid();
    setStatus("已进入移动模式。按住选中区块拖动，或使用 WASD / 方向键调整位置。 ");
  }

  function setMoveOffset(rowOffset, colOffset) {
    const session = state.moveSession;
    if (!session) return;
    session.rowOffset = Math.max(session.limits.minRowOffset, Math.min(session.limits.maxRowOffset, rowOffset));
    session.colOffset = Math.max(session.limits.minColOffset, Math.min(session.limits.maxColOffset, colOffset));
    drawGrid();
  }

  function nudgeMoveSession(rowDelta, colDelta, warnAtBoundary = false) {
    const session = state.moveSession;
    if (!session) return;
    const nextRow = session.rowOffset + rowDelta;
    const nextCol = session.colOffset + colDelta;
    const blocked = nextRow < session.limits.minRowOffset || nextRow > session.limits.maxRowOffset
      || nextCol < session.limits.minColOffset || nextCol > session.limits.maxColOffset;
    if (blocked) {
      if (warnAtBoundary) {
        const direction = rowDelta < 0 ? "上" : rowDelta > 0 ? "下" : colDelta < 0 ? "左" : "右";
        setStatus(`区块已到达画板${direction}侧边缘，无法向${direction}移动。`, true);
        showBoundaryNotice(direction);
      }
      return;
    }
    setMoveOffset(nextRow, nextCol);
  }

  function finishMoveSession({ silent = false } = {}) {
    const session = state.moveSession;
    if (!session) return false;
    const moved = session.rowOffset !== 0 || session.colOffset !== 0;
    if (moved) {
      beginMutation(true);
      const result = buildMoveResult(session);
      state.grid = result.grid;
      state.selection = result.selection;
    } else {
      state.selection = session.selection;
    }
    state.moveSession = null;
    syncMoveControls();
    if (moved) {
      endMutation();
      afterSelectionChange(false);
      if (!silent) setStatus("区块移动已完成，可继续编辑当前选区。 ");
    } else {
      drawGrid();
      if (!silent) setStatus("区块位置没有改变，未产生新的撤销记录。 ");
    }
    return moved;
  }

  function cancelMoveSession() {
    const session = state.moveSession;
    if (!session) return;
    state.selection = session.selection;
    state.moveSession = null;
    syncMoveControls();
    afterSelectionChange();
    setStatus("已取消此次区块移动。 ");
  }

  function replaceColor() {
    const from = Number(el.replaceFrom.value);
    if (from === state.selected) {
      setStatus("来源色和当前色相同，不需要替换。", true);
      return;
    }
    beginMutation();
    let count = 0;
    for (let i = 0; i < state.grid.length; i++) {
      if (state.grid[i] === from) { state.grid[i] = state.selected; count++; }
    }
    endMutation();
    setStatus(count ? `已将 ${String(from).padStart(2, "0")} 的 ${count} 格替换为 ${String(state.selected).padStart(2, "0")}。` : "网格中没有这种来源色。 ");
  }

  function createPixelCanvas(scale = 1) {
    const canvas = document.createElement("canvas");
    canvas.width = GRID * scale;
    canvas.height = GRID * scale;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        ctx.fillStyle = PALETTE[state.grid[row * GRID + col] - 1];
        ctx.fillRect(col * scale, row * scale, scale, scale);
      }
    }
    return canvas;
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

  function createNumberCanvas(includeLegend) {
    const cell = 44, margin = 58;
    const board = margin * 2 + cell * GRID;
    const legendWidth = includeLegend ? 600 : 0;
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
    for (let i = 0; i < GRID; i++) {
      ctx.fillText(String(i + 1), margin + (i + 0.5) * cell, margin / 2);
      ctx.fillText(String(i + 1), margin / 2, margin + (i + 0.5) * cell);
    }
    ctx.font = '700 16px "Microsoft YaHei UI", sans-serif';
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const id = state.grid[row * GRID + col];
        const x = margin + col * cell, y = margin + row * cell;
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
    if (includeLegend) drawLegend(ctx, board, 0, legendWidth, board);
    drawDrawingSignature(ctx, canvas);
    return canvas;
  }

  function drawLegend(ctx, left, top, width, height) {
    const counts = new Uint16Array(41);
    state.grid.forEach(id => counts[id]++);
    ctx.fillStyle = "#f9f9f7";
    ctx.fillRect(left, top, width, height);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#202422";
    ctx.font = '700 25px "Microsoft YaHei UI", sans-serif';
    ctx.fillText("奇象巡展·赛博拼豆制图工具", left + 22, top + 40);
    ctx.fillStyle = "#5e6864";
    ctx.font = '13px "Microsoft YaHei UI", sans-serif';
    ctx.fillText("固定40色（原编号）·每行2色，按游戏颜料顺序排列", left + 22, top + 67);
    const columns = 2;
    const rows = 20;
    const side = 22;
    const columnGap = 18;
    const startY = top + 92;
    const rowHeight = Math.floor((height - 146) / rows);
    const itemWidth = Math.floor((width - side * 2 - columnGap) / columns);
    const swatchWidth = 42;
    const swatchHeight = 34;
    for (let i = 0; i < 40; i++) {
      const column = i % columns, row = Math.floor(i / columns);
      const x = left + side + column * (itemWidth + columnGap);
      const y = startY + row * rowHeight;
      ctx.fillStyle = PALETTE[i];
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
      ctx.fillText(String(i + 1).padStart(2, "0"), infoX, centerY);

      ctx.fillStyle = "#59615e";
      ctx.font = '12px Consolas, monospace';
      ctx.fillText(PALETTE[i], infoX + 33, centerY);

      ctx.font = '13px "Microsoft YaHei UI", sans-serif';
      ctx.fillText(`${counts[i + 1]}格`, infoX + 111, centerY);
    }
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#4b5551";
    ctx.font = '14px "Microsoft YaHei UI", sans-serif';
    ctx.fillText(`24 × 24，共576格；实际使用固定色板中的 ${new Set(state.grid).size} 色`, left + 22, top + height - 28);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function downloadCanvas(canvas, filename, onSuccess) {
    canvas.toBlob(blob => {
      if (!blob) return setStatus("浏览器无法生成PNG，请换用Edge或Chrome。", true);
      downloadBlob(blob, filename);
      if (typeof onSuccess === "function") onSuccess(filename);
      else setStatus(`已导出 ${filename}`);
    }, "image/png");
  }

  function syncPngExportMode() {
    const raw = state.pngExportMode === "raw";
    el.pngModeLabel.textContent = raw ? "原始位图" : "放大预览";
    el.pngPreviewDescription.hidden = raw;
    el.pngRawDescription.hidden = !raw;
    el.pngModeToggle.setAttribute("aria-pressed", String(raw));
    el.pngModeToggle.setAttribute("aria-label", raw
      ? "当前为原始位图，点击切换为放大预览"
      : "当前为放大预览，点击切换为原始位图");
    el.exportPreviewBtn.setAttribute("aria-label", raw ? "导出24×24 PNG原始位图" : "导出PNG放大预览");
  }

  function togglePngExportMode() {
    state.pngExportMode = state.pngExportMode === "preview" ? "raw" : "preview";
    syncPngExportMode();
  }

  function exportPng() {
    const raw = state.pngExportMode === "raw";
    const scale = raw ? 1 : 24;
    const suffix = raw ? "_24x24_PNG原始位图.png" : "_24x24_PNG预览.png";
    downloadCanvas(createPixelCanvas(scale), `${safeName()}${suffix}`);
  }

  function createProjectData(savedAt = new Date().toISOString()) {
    return {
      format: "arknights_draw-project",
      version: 1,
      gridSize: GRID,
      palette: PALETTE,
      grid: Array.from(state.grid),
      selected: state.selected,
      fileName: safeName(),
      settings: {
        mode: el.modeSelect.value,
        contrast: Number(el.contrastRange.value),
        saturation: Number(el.saturationRange.value),
        darkThreshold: 100 - Number(el.darkThresholdRange.value),
        dominantThreshold: 100 - Number(el.dominantThresholdRange.value),
        showNumbers: el.showNumbers.checked,
        showGrid: el.showGrid.checked,
        showOverview: el.showOverview.checked
      },
      savedAt
    };
  }

  function validateProject(project) {
    if (!project || project.format !== "arknights_draw-project" || project.gridSize !== GRID || !Array.isArray(project.grid) || project.grid.length !== GRID * GRID) {
      throw new Error("不是有效的24×24工程文件");
    }
    if (project.grid.some(id => !Number.isInteger(id) || id < 1 || id > 40)) {
      throw new Error("工程中含有固定色板以外的编号");
    }
  }

  function applyProject(project) {
    validateProject(project);
    if (project.fileName) el.fileName.value = String(project.fileName).slice(0, 40);
    if (project.settings) {
      if (["hybrid", "dominant", "average"].includes(project.settings.mode)) el.modeSelect.value = project.settings.mode;
      if (Number.isFinite(project.settings.contrast)) el.contrastRange.value = String(project.settings.contrast);
      if (Number.isFinite(project.settings.saturation)) el.saturationRange.value = String(project.settings.saturation);
      el.darkThresholdRange.value = String(100 - (Number.isFinite(project.settings.darkThreshold)
        ? Math.max(0, Math.min(100, project.settings.darkThreshold))
        : DEFAULT_DARK_THRESHOLD));
      el.dominantThresholdRange.value = String(100 - (Number.isFinite(project.settings.dominantThreshold)
        ? Math.max(0, Math.min(100, project.settings.dominantThreshold))
        : DEFAULT_DOMINANT_THRESHOLD));
      el.showNumbers.checked = project.settings.showNumbers !== false;
      el.showGrid.checked = project.settings.showGrid !== false;
      el.showOverview.checked = project.settings.showOverview !== false;
      syncOverviewVisibility();
      syncHybridThresholdVisibility();
    }
    if (project.selected) selectColor(project.selected);
    syncOutputs();
    commitGrid(project.grid);
  }

  function saveProject() {
    const project = createProjectData();
    const name = `${safeName()}_工程.json`;
    downloadBlob(new Blob([JSON.stringify(project, null, 2)], { type: "application/json;charset=utf-8" }), name);
    setStatus(`工程已保存：${name}（不包含原图）`);
  }

  function loadProjectFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const project = JSON.parse(String(reader.result));
        applyProject(project);
        setStatus("工程已载入，可以继续修改或导出。 ");
      } catch (error) {
        setStatus(`载入失败：${error.message}`, true);
      } finally {
        el.projectInput.value = "";
      }
    };
    reader.readAsText(file, "utf-8");
  }

  function historySignature(project) {
    return `${project.fileName}|${project.grid.join(",")}`;
  }

  function loadExportHistory() {
    try {
      const saved = JSON.parse(localStorage.getItem(EXPORT_HISTORY_KEY) || "[]");
      if (!Array.isArray(saved)) return;
      exportHistory = saved.filter(record => {
        try {
          validateProject(record?.project);
          record.project.fileName = drawingName(record.project.fileName);
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
    canvas.width = GRID;
    canvas.height = GRID;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        ctx.fillStyle = PALETTE[grid[row * GRID + col] - 1];
        ctx.fillRect(col, row, 1, 1);
      }
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
      setStatus(`已从导出历史载入“${drawingName(record.project.fileName)}”，可以继续修改。`);
      el.gridCanvas.closest(".editor-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      setStatus(`历史记录载入失败：${error.message}`, true);
    }
  }

  function removeHistoryRecord(id) {
    const record = exportHistory.find(item => item.id === id);
    if (!record || !window.confirm(`删除历史记录“${drawingName(record.project.fileName)}”？`)) return;
    exportHistory = exportHistory.filter(item => item.id !== id);
    persistExportHistory();
    renderExportHistory();
    setStatus("已删除一条导出历史。 ");
  }

  function renderExportHistory() {
    el.exportHistory.replaceChildren();
    el.historyCount.textContent = `${exportHistory.length} 份`;
    el.clearHistoryBtn.disabled = exportHistory.length === 0;
    if (!exportHistory.length) {
      const empty = document.createElement("p");
      empty.className = "history-empty";
      empty.textContent = "尚无记录。第一次导出图纸后会自动出现在这里。";
      el.exportHistory.append(empty);
      return;
    }

    exportHistory.forEach(record => {
      const card = document.createElement("article");
      card.className = "history-card";

      const loadButton = document.createElement("button");
      loadButton.type = "button";
      loadButton.className = "history-load";
      loadButton.setAttribute("aria-label", `载入历史图纸 ${drawingName(record.project.fileName)}`);

      const canvas = document.createElement("canvas");
      canvas.className = "history-thumb";
      canvas.setAttribute("aria-hidden", "true");
      drawHistoryThumbnail(canvas, record.project.grid);

      const copy = document.createElement("span");
      copy.className = "history-copy";
      const name = document.createElement("strong");
      name.textContent = drawingName(record.project.fileName);
      const meta = document.createElement("span");
      meta.textContent = `${new Set(record.project.grid).size} 色 · 24×24`;
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
      deleteButton.setAttribute("aria-label", `删除历史记录 ${drawingName(record.project.fileName)}`);
      deleteButton.addEventListener("click", () => removeHistoryRecord(record.id));

      card.append(loadButton, deleteButton);
      el.exportHistory.append(card);
    });
  }

  function recordExportHistory() {
    const exportedAt = new Date().toISOString();
    const project = createProjectData(exportedAt);
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
    if (!exportHistory.length || !window.confirm("清空全部导出历史？已下载的PNG和手动保存的JSON不会被删除。")) return;
    exportHistory = [];
    persistExportHistory();
    renderExportHistory();
    setStatus("导出历史已清空；已下载文件不受影响。 ");
  }

  function exportTotal() {
    const name = `${safeName()}_24x24_图纸.png`;
    downloadCanvas(createNumberCanvas(true), name, filename => {
      const persisted = recordExportHistory();
      setStatus(persisted
        ? `已导出 ${filename}，并加入导出历史。`
        : `已导出 ${filename}；当前浏览器禁止本地存储，历史只能保留到本页关闭前。`);
    });
  }

  function saveLocal() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ grid: Array.from(state.grid), fileName: el.fileName.value }));
    } catch (_) { /* file:// privacy settings may disable storage */ }
  }

  function restoreLocal() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved && Array.isArray(saved.grid) && saved.grid.length === GRID * GRID && saved.grid.every(id => Number.isInteger(id) && id >= 1 && id <= 40)) {
        state.grid = new Uint8Array(saved.grid);
        if (saved.fileName) el.fileName.value = drawingName(saved.fileName).slice(0, 40);
      }
    } catch (_) { /* ignore damaged local cache */ }
  }

  function syncOutputs() {
    el.zoomOut.textContent = `${el.zoomRange.value}%`;
    el.contrastOut.textContent = Number(el.contrastRange.value) > 0 ? `+${el.contrastRange.value}` : el.contrastRange.value;
    el.saturationOut.textContent = Number(el.saturationRange.value) > 0 ? `+${el.saturationRange.value}` : el.saturationRange.value;
    el.darkThresholdOut.textContent = `${el.darkThresholdRange.value}%`;
    el.dominantThresholdOut.textContent = `${el.dominantThresholdRange.value}%`;
  }

  function syncHybridThresholdVisibility() {
    const visible = el.modeSelect.value === "hybrid";
    el.hybridThresholds.hidden = !visible;
    el.hybridThresholds.closest(".control-grid").classList.toggle("show-hybrid-thresholds", visible);
  }

  function resetImageParameters() {
    el.contrastRange.value = "0";
    el.saturationRange.value = "0";
    el.darkThresholdRange.value = String(100 - DEFAULT_DARK_THRESHOLD);
    el.dominantThresholdRange.value = String(100 - DEFAULT_DOMINANT_THRESHOLD);
    syncOutputs();
    schedulePixelPreview();
    forcePixelPreview();
  }

  function syncOverviewVisibility() {
    const visible = el.showOverview.checked;
    el.overviewCard.hidden = !visible;
    el.editorBoardLayout.classList.toggle("overview-hidden", !visible);
  }

  function bindEvents() {
    document.addEventListener("click", event => {
      if (!state.moveSession) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-move-session-control]") || target === el.gridCanvas) return;
      if (target.closest("button, input, select, a, label, canvas")) finishMoveSession({ silent: true });
    }, true);

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
    const stopCropDrag = () => {
      state.cropDrag = null;
      el.sourceCanvas.classList.remove("dragging");
      forcePixelPreview();
    };
    el.sourceCanvas.addEventListener("pointerup", stopCropDrag);
    el.sourceCanvas.addEventListener("pointercancel", stopCropDrag);
    el.sourceCanvas.addEventListener("lostpointercapture", stopCropDrag);
    el.sourceCanvas.addEventListener("wheel", event => {
      event.preventDefault();
      const next = Math.max(100, Math.min(400, Number(el.zoomRange.value) + (event.deltaY < 0 ? 10 : -10)));
      el.zoomRange.value = String(next);
      state.zoom = next / 100;
      syncOutputs();
      drawSource();
      if (wheelFinalTimer) window.clearTimeout(wheelFinalTimer);
      wheelFinalTimer = window.setTimeout(() => {
        wheelFinalTimer = 0;
        forcePixelPreview();
      }, WHEEL_FINAL_DELAY);
    }, { passive: false });

    el.zoomRange.addEventListener("input", () => { state.zoom = Number(el.zoomRange.value) / 100; syncOutputs(); drawSource(); });
    el.zoomRange.addEventListener("change", forcePixelPreview);
    el.contrastRange.addEventListener("input", () => { syncOutputs(); schedulePixelPreview(); });
    el.contrastRange.addEventListener("change", forcePixelPreview);
    el.saturationRange.addEventListener("input", () => { syncOutputs(); schedulePixelPreview(); });
    el.saturationRange.addEventListener("change", forcePixelPreview);
    el.darkThresholdRange.addEventListener("input", () => { syncOutputs(); schedulePixelPreview(); });
    el.darkThresholdRange.addEventListener("change", forcePixelPreview);
    el.dominantThresholdRange.addEventListener("input", () => { syncOutputs(); schedulePixelPreview(); });
    el.dominantThresholdRange.addEventListener("change", forcePixelPreview);
    el.modeSelect.addEventListener("change", () => { syncHybridThresholdVisibility(); schedulePixelPreview(); forcePixelPreview(); });
    el.resetCropBtn.addEventListener("click", () => { resetCrop(false); forcePixelPreview(); });
    el.fitSubjectBtn.addEventListener("click", () => { resetCrop(!state.fitFull); forcePixelPreview(); });
    el.resetParamsBtn.addEventListener("click", resetImageParameters);
    el.removeImageBtn.addEventListener("click", event => { event.stopPropagation(); removeSourceImage(); });
    el.generateBtn.addEventListener("click", buildGridFromImage);

    document.querySelectorAll(".tool[data-tool]").forEach(button => button.addEventListener("click", () => setTool(button.dataset.tool)));
    document.querySelectorAll("[data-selection-operation]").forEach(button => button.addEventListener("click", () => setSelectionOperation(button.dataset.selectionOperation)));
    document.querySelectorAll("[data-selection-method]").forEach(button => button.addEventListener("click", () => setSelectionMethod(button.dataset.selectionMethod)));
    el.selectAllBtn.addEventListener("click", () => { state.selection.fill(1); afterSelectionChange(); });
    el.clearSelectionBtn.addEventListener("click", () => clearSelection());
    el.colorSelectionBtn.addEventListener("click", colorSelection);
    el.moveStartBtn.addEventListener("click", startMoveSession);
    el.moveConfirmBtn.addEventListener("click", () => finishMoveSession());
    el.moveCancelBtn.addEventListener("click", cancelMoveSession);
    el.undoBtn.addEventListener("click", undo);
    el.redoBtn.addEventListener("click", redo);
    el.showNumbers.addEventListener("change", drawGrid);
    el.showGrid.addEventListener("change", drawGrid);
    el.showOverview.addEventListener("change", syncOverviewVisibility);
    el.showSelectionMask.addEventListener("change", drawGrid);
    el.showSelectionBorder.addEventListener("change", drawGrid);
    el.replaceBtn.addEventListener("click", replaceColor);

    el.gridCanvas.addEventListener("pointerdown", event => {
      const cell = cellFromEvent(event);
      if (!cell) return;
      el.gridCanvas.setPointerCapture(event.pointerId);
      if (event.button === 2 || state.tool === "picker") {
        if (state.moveSession) finishMoveSession({ silent: true });
        selectColor(state.grid[cell.index]);
        setStatus(`已从 R${cell.row + 1} C${cell.col + 1} 取得颜色 ${String(state.selected).padStart(2, "0")}。`);
        return;
      }
      if (state.tool === "block") {
        if (state.moveSession) {
          if (event.button !== 0) return;
          const displayedSelection = buildMoveResult().selection;
          if (displayedSelection[cell.index]) {
            state.moveSession.drag = {
              start: cell,
              rowOffset: state.moveSession.rowOffset,
              colOffset: state.moveSession.colOffset
            };
            el.gridCanvas.classList.add("move-dragging");
          }
          return;
        }
        if (state.selectionMethod === "fill") {
          selectConnectedRegion(cell.index);
        } else if (state.selectionMethod === "rect") {
          state.selectionDrag = { method: "rect", start: cell, current: cell };
          drawGrid();
        } else {
          state.selectionDrag = { method: "brush" };
          state.selectionLastCell = cell;
          applySelectionCell(cell);
          afterSelectionChange();
        }
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
      if (cell) {
        const displayGrid = state.moveSession ? buildMoveResult().grid : state.grid;
        el.cellInfo.textContent = `R${cell.row + 1} C${cell.col + 1} · ${String(displayGrid[cell.index]).padStart(2, "0")}`;
      }
      if (state.moveSession?.drag) {
        const current = clampedCellFromEvent(event);
        const drag = state.moveSession.drag;
        setMoveOffset(
          drag.rowOffset + current.row - drag.start.row,
          drag.colOffset + current.col - drag.start.col
        );
        return;
      }
      if (state.tool === "block" && state.selectionDrag && cell) {
        if (state.selectionDrag.method === "rect") {
          state.selectionDrag.current = cell;
          drawGrid();
        } else if (state.selectionDrag.method === "brush" && (!state.selectionLastCell || cell.index !== state.selectionLastCell.index)) {
          applySelectionLine(state.selectionLastCell, cell);
          state.selectionLastCell = cell;
        }
      }
      if (state.painting && state.tool === "paint") paintCell(cell);
    });
    el.gridCanvas.addEventListener("pointerleave", () => { if (!state.painting && !state.selectionDrag) el.cellInfo.textContent = "R— C—"; });
    const stopPainting = event => {
      if (state.moveSession?.drag) {
        state.moveSession.drag = null;
        el.gridCanvas.classList.remove("move-dragging");
        return;
      }
      if (state.painting) { state.painting = false; endMutation(); }
      if (state.selectionDrag) {
        const drag = state.selectionDrag;
        const end = cellFromEvent(event) || drag.current || state.selectionLastCell;
        state.selectionDrag = null;
        state.selectionLastCell = null;
        if (drag.method === "rect" && end) applyRectangleSelection(drag.start, end);
        else drawGrid();
      }
    };
    el.gridCanvas.addEventListener("pointerup", stopPainting);
    el.gridCanvas.addEventListener("pointercancel", stopPainting);
    window.addEventListener("pointerup", stopPainting);
    el.gridCanvas.addEventListener("contextmenu", event => event.preventDefault());

    document.addEventListener("keydown", event => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "z") {
        event.preventDefault();
        if (state.moveSession) finishMoveSession({ silent: true });
        event.shiftKey ? redo() : undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === "y") {
        event.preventDefault();
        if (state.moveSession) finishMoveSession({ silent: true });
        redo();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const toolShortcuts = { "1": "paint", "2": "fill", "3": "picker", "4": "block" };
      const moves = {
        w: [-1, 0], arrowup: [-1, 0],
        s: [1, 0], arrowdown: [1, 0],
        a: [0, -1], arrowleft: [0, -1],
        d: [0, 1], arrowright: [0, 1]
      };

      if (state.moveSession) {
        if (key === "f") {
          event.preventDefault();
          if (!event.repeat) finishMoveSession();
          return;
        }
        if (key === "g") {
          event.preventDefault();
          if (!event.repeat) cancelMoveSession();
          return;
        }
        if (moves[key]) {
          event.preventDefault();
          nudgeMoveSession(...moves[key], true);
          return;
        }
        if (toolShortcuts[key] || key === "q" || key === "e" || key === "r") {
          finishMoveSession({ silent: true });
        } else {
          return;
        }
      }

      if (toolShortcuts[key]) {
        event.preventDefault();
        if (event.repeat) return;
        setTool(toolShortcuts[key]);
        return;
      }
      if (state.tool !== "block") return;
      if (key === "f") {
        event.preventDefault();
        if (!event.repeat) startMoveSession();
      } else if (key === "q") {
        event.preventDefault();
        if (event.repeat) return;
        setSelectionOperation(state.selectionOperation === "add" ? "subtract" : "add");
      } else if (key === "e") {
        event.preventDefault();
        if (event.repeat) return;
        const methods = ["brush", "fill", "rect"];
        setSelectionMethod(methods[(methods.indexOf(state.selectionMethod) + 1) % methods.length]);
      } else if (key === "r") {
        event.preventDefault();
        if (event.repeat) return;
        colorSelection();
      }
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
    el.authorDialog.addEventListener("click", event => {
      if (event.target === el.authorDialog) el.authorDialog.close();
    });
    el.saveProjectBtn.addEventListener("click", saveProject);
    el.exportPreviewBtn.addEventListener("click", exportPng);
    el.pngModeToggle.addEventListener("click", togglePngExportMode);
    el.exportPngCard.addEventListener("click", event => {
      if (!event.target.closest("button, a")) exportPng();
    });
    el.exportTotalBtn.addEventListener("click", exportTotal);
    el.clearHistoryBtn.addEventListener("click", clearExportHistory);
  }

  function init() {
    restoreLocal();
    loadExportHistory();
    renderPalette();
    renderCoordinateAxes();
    renderExportHistory();
    bindEvents();
    syncOutputs();
    syncPngExportMode();
    syncHybridThresholdVisibility();
    syncOverviewVisibility();
    syncMoveControls();
    drawGrid();
    updatePaletteCounts();
    updateHistoryButtons();
    afterSelectionChange(false);
    if ("ResizeObserver" in window) {
      gridResizeObserver = new ResizeObserver(syncGridCanvasResolution);
      gridResizeObserver.observe(el.gridCanvas);
    }
    window.addEventListener("resize", syncGridCanvasResolution);
    window.requestAnimationFrame(syncGridCanvasResolution);
  }

  init();
})();
