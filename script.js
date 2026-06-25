const state = {
  mode: "diagram",
  resultView: "preview",
  selectedSample: "flow",
  uploadedName: "",
  imageDataUrl: "",
  imageUrl: "",
  lastResult: null,
  previewTimer: null,
  toastTimer: null
};

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FREE_DAILY_LIMIT = 3;
const historyKey = "picstruct-history-v1";
const usageKey = "picstruct-usage-v1";
const accessCodeKey = "picstruct-access-code-v1";
const parseEndpoint = window.PICSTRUCT_API_ENDPOINT
  || (window.location.protocol.startsWith("http") ? "/api/parse" : "");

const samples = {
  flow: {
    mode: "diagram",
    src: "assets/sample-flow.svg",
    name: "sample-flow.svg"
  },
  chart: {
    mode: "chart",
    src: "assets/sample-chart.svg",
    name: "sample-chart.svg"
  }
};

const demoResults = {
  diagram: {
    mermaid: `flowchart TD
  A[Capture visual input] --> B[Detect nodes and labels]
  B --> C{Classify structure}
  C -->|Process map| D[Generate Mermaid flowchart]
  C -->|System sketch| E[Generate architecture diagram]
  D --> F[Review editable code]
  E --> F
  F --> G[Export to Markdown or docs]`,
    markdown: `# Extracted diagram brief

PicStruct detected a process-style diagram with seven primary nodes and directional links.

## Structure

- Capture visual input
- Detect nodes and labels
- Classify structure
- Generate Mermaid flowchart
- Generate architecture diagram
- Review editable code
- Export to Markdown or docs

## Suggested Mermaid

\`\`\`mermaid
flowchart TD
  A[Capture visual input] --> B[Detect nodes and labels]
  B --> C{Classify structure}
  C -->|Process map| D[Generate Mermaid flowchart]
  C -->|System sketch| E[Generate architecture diagram]
  D --> F[Review editable code]
  E --> F
  F --> G[Export to Markdown or docs]
\`\`\``,
    json: {
      type: "diagram",
      format: "flowchart",
      nodes: [
        { id: "A", label: "Capture visual input" },
        { id: "B", label: "Detect nodes and labels" },
        { id: "C", label: "Classify structure" },
        { id: "D", label: "Generate Mermaid flowchart" },
        { id: "E", label: "Generate architecture diagram" },
        { id: "F", label: "Review editable code" },
        { id: "G", label: "Export to Markdown or docs" }
      ],
      edges: [
        ["A", "B"],
        ["B", "C"],
        ["C", "D"],
        ["C", "E"],
        ["D", "F"],
        ["E", "F"],
        ["F", "G"]
      ],
      confidence: "demo"
    },
    metrics: { nodes: 7, links: 7, confidence: "Demo" },
    summary: "Demo flowchart output is ready for editing and Mermaid preview.",
    warnings: ["Demo data is illustrative and not extracted from the selected image."]
  },
  chart: {
    csv: `quarter,visitors,paid_conversions
Q1,4200,126
Q2,6800,231
Q3,9100,346
Q4,12400,512`,
    markdown: `# Extracted chart brief

PicStruct detected a quarterly growth chart with visitor and conversion series.

## Takeaways

- Visitors rose from 4,200 in Q1 to 12,400 in Q4.
- Paid conversions increased from 126 to 512.
- Conversion growth accelerates after Q2.

## CSV

\`\`\`csv
quarter,visitors,paid_conversions
Q1,4200,126
Q2,6800,231
Q3,9100,346
Q4,12400,512
\`\`\``,
    json: {
      type: "chart",
      chartType: "bar-line hybrid",
      xAxis: "quarter",
      series: [
        { name: "visitors", values: [4200, 6800, 9100, 12400] },
        { name: "paid_conversions", values: [126, 231, 346, 512] }
      ],
      rows: [
        { quarter: "Q1", visitors: 4200, paid_conversions: 126 },
        { quarter: "Q2", visitors: 6800, paid_conversions: 231 },
        { quarter: "Q3", visitors: 9100, paid_conversions: 346 },
        { quarter: "Q4", visitors: 12400, paid_conversions: 512 }
      ],
      confidence: "demo"
    },
    metrics: { nodes: 4, links: 2, confidence: "Demo" },
    summary: "Demo chart output is available as CSV, JSON, or Markdown.",
    warnings: ["Demo values are illustrative. Use AI parsing for real chart extraction."]
  }
};

const els = {
  modeButtons: document.querySelectorAll(".mode-button"),
  resultTabs: document.querySelectorAll(".result-tab"),
  fileInput: document.getElementById("fileInput"),
  dropzone: document.getElementById("dropzone"),
  imagePreview: document.getElementById("imagePreview"),
  sampleButtons: document.querySelectorAll(".sample-button"),
  outputSelect: document.getElementById("outputSelect"),
  detailSelect: document.getElementById("detailSelect"),
  presetSelect: document.getElementById("presetSelect"),
  instructionInput: document.getElementById("instructionInput"),
  generateButton: document.getElementById("generateButton"),
  resultCaption: document.getElementById("resultCaption"),
  diagramPreview: document.getElementById("diagramPreview"),
  tablePreview: document.getElementById("tablePreview"),
  codeEditor: document.getElementById("codeEditor"),
  dataOutput: document.getElementById("dataOutput"),
  copyButton: document.getElementById("copyButton"),
  downloadButton: document.getElementById("downloadButton"),
  fileMeta: document.getElementById("fileMeta"),
  imageUrlInput: document.getElementById("imageUrlInput"),
  loadUrlButton: document.getElementById("loadUrlButton"),
  recentList: document.getElementById("recentList"),
  clearHistoryButton: document.getElementById("clearHistoryButton"),
  nodesMetric: document.getElementById("nodesMetric"),
  linksMetric: document.getElementById("linksMetric"),
  confidenceMetric: document.getElementById("confidenceMetric"),
  parserStatus: document.getElementById("parserStatus"),
  parserStatusText: document.getElementById("parserStatusText"),
  summaryText: document.getElementById("summaryText"),
  warningList: document.getElementById("warningList"),
  quotaStrip: document.getElementById("quotaStrip"),
  quotaText: document.getElementById("quotaText"),
  upgradePanel: document.getElementById("upgradePanel"),
  dismissUpgradeButton: document.getElementById("dismissUpgradeButton"),
  accessForm: document.getElementById("accessForm"),
  accessCodeInput: document.getElementById("accessCodeInput"),
  clearAccessCodeButton: document.getElementById("clearAccessCodeButton"),
  accessStatus: document.getElementById("accessStatus"),
  toast: document.getElementById("toast")
};

function setMode(mode, options = {}) {
  state.mode = mode;

  els.modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });

  const selectedOutput = els.outputSelect.value;
  els.outputSelect.innerHTML = "";
  const modeOptions = mode === "diagram"
    ? [
        ["mermaid", "Mermaid diagram"],
        ["markdown", "Markdown brief"],
        ["json", "Structured JSON"]
      ]
    : [
        ["csv", "CSV table"],
        ["markdown", "Markdown brief"],
        ["json", "Structured JSON"]
      ];

  modeOptions.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    els.outputSelect.appendChild(option);
  });

  const valid = modeOptions.some(([value]) => value === selectedOutput);
  els.outputSelect.value = valid ? selectedOutput : modeOptions[0][0];

  if (!options.keepSample) {
    const sampleKey = mode === "diagram" ? "flow" : "chart";
    loadSample(sampleKey, { silent: true, keepMode: true });
  }

  if (!options.skipRender) {
    renderResult(makeDemoResult());
  }
}

function loadSample(sampleKey, options = {}) {
  const sample = samples[sampleKey];
  if (!sample) return;

  state.selectedSample = sampleKey;
  state.uploadedName = sample.name;
  state.imageDataUrl = "";
  state.imageUrl = "";
  els.imageUrlInput.value = "";
  els.imagePreview.src = sample.src;
  els.imagePreview.alt = `${sampleKey} sample preview`;
  updateFileMeta(`Sample loaded: ${sample.name}`);

  els.sampleButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.sample === sampleKey);
  });

  if (!options.keepMode) {
    setMode(sample.mode, { keepSample: true });
  }

  if (!options.silent) {
    showToast(`${sampleKey === "flow" ? "Flowchart" : "Chart"} sample loaded`);
  }
}

function makeDemoResult() {
  const base = demoResults[state.mode];
  const selectedOutput = els.outputSelect.value;
  const detail = els.detailSelect.value;
  const preset = els.presetSelect.value;
  const instructions = els.instructionInput.value.trim();

  if (state.mode === "diagram") {
    const code = selectedOutput === "markdown"
      ? base.markdown
      : selectedOutput === "json"
        ? JSON.stringify(base.json, null, 2)
        : base.mermaid;

    return {
      mode: state.mode,
      output: selectedOutput,
      detail,
      preset,
      instructions,
      fileName: state.uploadedName || samples.flow.name,
      previewType: "mermaid",
      code,
      mermaid: base.mermaid,
      data: JSON.stringify(base.json, null, 2),
      metrics: base.metrics,
      summary: makeDemoSummary(base.summary, preset, instructions),
      warnings: base.warnings
    };
  }

  const code = selectedOutput === "markdown"
    ? base.markdown
    : selectedOutput === "json"
      ? JSON.stringify(base.json, null, 2)
      : base.csv;

  return {
    mode: state.mode,
    output: selectedOutput,
    detail,
    preset,
    instructions,
    fileName: state.uploadedName || samples.chart.name,
    previewType: "table",
    code,
    csv: base.csv,
    data: JSON.stringify(base.json, null, 2),
    metrics: base.metrics,
    summary: makeDemoSummary(base.summary, preset, instructions),
    warnings: base.warnings
  };
}

function makeDemoSummary(base, preset, instructions) {
  const presetCopy = {
    editable: "Editable source preset selected.",
    docs: "Documentation-ready preset selected.",
    data: "Data-first preset selected.",
    accessibility: "Accessibility text preset selected."
  };
  const note = instructions ? ` User note: ${instructions}` : "";
  return `${base} ${presetCopy[preset] || presetCopy.editable}${note}`;
}

async function renderResult(result) {
  state.lastResult = result;
  els.codeEditor.value = result.code;
  els.dataOutput.textContent = result.data;
  els.nodesMetric.textContent = result.metrics.nodes;
  els.linksMetric.textContent = result.metrics.links;
  els.confidenceMetric.textContent = result.metrics.confidence;
  renderReview(result.summary, result.warnings);

  if (result.previewType === "mermaid") {
    els.resultCaption.textContent = "Mermaid output with a live diagram preview.";
    els.tablePreview.hidden = true;
    els.diagramPreview.hidden = false;
    await renderMermaid(result.mermaid);
  } else {
    els.resultCaption.textContent = "CSV output with a clean table preview.";
    els.diagramPreview.hidden = true;
    els.tablePreview.hidden = false;
    renderTable(result.csv);
  }
}

function renderReview(summary, warnings) {
  els.summaryText.textContent = summary || "Review the generated output before reuse.";
  const items = Array.isArray(warnings) && warnings.length
    ? warnings
    : ["No warnings returned."];

  els.warningList.innerHTML = "";
  for (const warning of items) {
    const li = document.createElement("li");
    li.textContent = warning;
    els.warningList.appendChild(li);
  }
}

async function renderMermaid(code) {
  els.diagramPreview.innerHTML = "";

  if (!window.picstructMermaid) {
    els.diagramPreview.innerHTML = `<div class="diagram-fallback">Mermaid preview will appear when the renderer is available. The editable code is ready in the Code tab.</div>`;
    return;
  }

  try {
    const id = `picstruct-${Date.now()}`;
    const rendered = await window.picstructMermaid.render(id, code);
    els.diagramPreview.innerHTML = rendered.svg;
  } catch (error) {
    els.diagramPreview.innerHTML = `<div class="diagram-fallback">Preview could not be rendered. Review the Mermaid code in the Code tab.</div>`;
  }
}

function renderTable(csv) {
  const rows = csv.trim().split(/\r?\n/).map((line) => splitCsvLine(line));
  const [header, ...body] = rows;

  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const headRow = document.createElement("tr");

  header.forEach((label) => {
    const th = document.createElement("th");
    th.textContent = label.replaceAll("_", " ");
    headRow.appendChild(th);
  });

  thead.appendChild(headRow);

  body.forEach((row) => {
    const tr = document.createElement("tr");
    header.forEach((_, index) => {
      const td = document.createElement("td");
      td.textContent = row[index] || "";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.append(thead, tbody);
  els.tablePreview.innerHTML = "";
  els.tablePreview.appendChild(table);
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function setResultView(view) {
  state.resultView = view;
  els.resultTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.view === view);
  });

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.viewPanel === view);
  });
}

async function handleGenerate() {
  els.generateButton.classList.add("is-working");
  els.generateButton.disabled = true;

  const apiResult = await tryParseWithApi();

  if (apiResult) {
    if (apiResult.limited || apiResult.blocked) {
      if (apiResult.plan) {
        syncUsageFromPlan(apiResult.plan);
        renderAccessStatus(apiResult.plan);
      }
      if (apiResult.message) {
        showToast(apiResult.message);
      }
      els.generateButton.disabled = false;
      els.generateButton.classList.remove("is-working");
      return;
    }

    if (apiResult.fallback) {
      await renderDemoFallback(apiResult.message);
      els.generateButton.disabled = false;
      els.generateButton.classList.remove("is-working");
      setResultView("preview");
      return;
    }

    await renderResult(apiResult);
    setParserStatus("ai");
    if (apiResult.plan) {
      syncUsageFromPlan(apiResult.plan);
      renderAccessStatus(apiResult.plan);
    } else if (apiResult.cache?.hit) {
      renderAccessStatus();
    } else if (hasPaidAccessCode()) {
      renderAccessStatus();
    } else {
      incrementUsage();
    }
    saveHistory(apiResult, "AI");
    showToast(apiResult.cache?.hit ? "Reused cached AI result" : "Structure generated with AI");
  } else {
    await renderDemoFallback(parseEndpoint ? "Demo result shown" : "Demo structure generated");
  }

  els.generateButton.disabled = false;
  els.generateButton.classList.remove("is-working");
  setResultView("preview");
}

async function renderDemoFallback(message) {
  await wait(360);
  const demoResult = makeDemoResult();
  await renderResult(demoResult);
  setParserStatus(parseEndpoint ? "fallback" : "demo");
  saveHistory(demoResult, "Demo");
  showToast(message || (parseEndpoint ? "Demo result shown" : "Demo structure generated"));
}

function handleFile(file) {
  if (!file) return;

  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
  if (!allowedTypes.has(file.type)) {
    showToast("Choose an image file");
    return;
  }

  if (file.size > MAX_FILE_BYTES) {
    showToast("Image must be 10 MB or smaller");
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    state.uploadedName = file.name;
    state.imageDataUrl = String(reader.result || "");
    state.imageUrl = "";
    els.imageUrlInput.value = "";
    els.imagePreview.src = reader.result;
    els.imagePreview.alt = file.name;
    updateFileMeta(`${file.name} - ${formatBytes(file.size)}`);
    els.sampleButtons.forEach((button) => button.classList.remove("is-selected"));
    renderResult(makeDemoResult());
    showToast("Image loaded");
  };
  reader.readAsDataURL(file);
}

function loadImageUrl() {
  const raw = els.imageUrlInput.value.trim();
  if (!raw) {
    showToast("Paste an image URL");
    return;
  }

  let url;
  try {
    url = new URL(raw);
  } catch (error) {
    showToast("Enter a valid image URL");
    return;
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    showToast("Use an HTTP or HTTPS image URL");
    return;
  }

  state.imageUrl = url.href;
  state.imageDataUrl = "";
  state.uploadedName = url.pathname.split("/").filter(Boolean).pop() || "remote-image";
  els.imagePreview.src = url.href;
  els.imagePreview.alt = state.uploadedName;
  els.sampleButtons.forEach((button) => button.classList.remove("is-selected"));
  updateFileMeta(`URL loaded: ${state.uploadedName}`);
  renderResult(makeDemoResult());
  showToast("Image URL loaded");
}

async function tryParseWithApi() {
  if (!parseEndpoint) return null;

  try {
    const image = state.imageDataUrl || await currentPreviewAsDataUrl();
    const imageUrl = state.imageUrl;
    if (!image && !imageUrl) return null;

    const headers = { "Content-Type": "application/json" };
    const accessCode = readAccessCode();
    if (accessCode) {
      headers["X-PicStruct-Access-Code"] = accessCode;
    }

    const response = await fetchWithClientTimeout(parseEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: state.mode,
        output: els.outputSelect.value,
        detail: els.detailSelect.value,
        preset: els.presetSelect.value,
        instructions: els.instructionInput.value.trim(),
        fileName: state.uploadedName,
        image,
        imageUrl
      })
    });

    const payload = response.ok ? null : await safeResponseJson(response);

    if (response.status === 400 || response.status === 413) {
      return {
        blocked: true,
        message: payload.error || (response.status === 413 ? "Image is too large" : "Image could not be parsed")
      };
    }

    if (response.status === 401) {
      return { blocked: true, message: "Access code not recognized" };
    }

    if (response.status === 402 || response.status === 429) {
      showUpgradePanel();
      return {
        limited: true,
        plan: payload.plan || null,
        message: response.status === 402 ? "Daily limit reached" : "Too many requests"
      };
    }

    if (response.status === 501) {
      return { fallback: true, message: "AI API is not configured; demo result shown" };
    }

    if (response.status === 504) {
      return { fallback: true, message: "AI request timed out; demo result shown" };
    }

    if (!response.ok) {
      return { fallback: true, message: "AI parser unavailable; demo result shown" };
    }

    return normalizeApiResult(await response.json());
  } catch (error) {
    if (error?.name === "AbortError") {
      return { fallback: true, message: "API request timed out; demo result shown" };
    }
    return { fallback: true, message: "Could not reach API; demo result shown" };
  }
}

async function fetchWithClientTimeout(url, options) {
  const config = window.PICSTRUCT_CONFIG || {};
  const timeoutMs = Number(config.apiTimeoutMs || 75000);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || typeof AbortController === "undefined") {
    return await fetch(url, options);
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timer);
  }
}

async function currentPreviewAsDataUrl() {
  if (state.imageUrl) return "";
  const src = els.imagePreview.getAttribute("src");
  if (!src) return "";
  if (src.startsWith("data:")) return src;
  if (!window.location.protocol.startsWith("http")) return "";

  const response = await fetch(src);
  if (!response.ok) return "";
  const blob = await response.blob();

  return await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => resolve("");
    reader.readAsDataURL(blob);
  });
}

function normalizeApiResult(payload) {
  const fallback = makeDemoResult();
  const dataObject = typeof payload.data === "object" && payload.data
    ? payload.data
    : safeJsonParse(payload.dataJson, {});
  const dataText = JSON.stringify(dataObject, null, 2);
  const previewType = payload.previewType === "table" ? "table" : "mermaid";
  const code = String(payload.code || fallback.code || "");
  const mermaid = String(payload.mermaid || (previewType === "mermaid" ? code : fallback.mermaid || ""));
  const csv = String(payload.csv || (previewType === "table" ? code : fallback.csv || ""));

  return {
    mode: payload.mode || state.mode,
    output: payload.output || els.outputSelect.value,
    detail: payload.detail || els.detailSelect.value,
    preset: payload.preset || els.presetSelect.value,
    instructions: payload.instructions || els.instructionInput.value.trim(),
    fileName: payload.fileName || state.uploadedName,
    previewType,
    code,
    mermaid,
    csv,
    data: dataText,
    metrics: {
      nodes: Number(payload.metrics?.nodes ?? fallback.metrics.nodes ?? 0),
      links: Number(payload.metrics?.links ?? fallback.metrics.links ?? 0),
      confidence: String(payload.metrics?.confidence ?? fallback.metrics.confidence ?? "AI")
    },
    summary: String(payload.summary || fallback.summary || ""),
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : fallback.warnings || [],
    plan: payload.plan || null,
    cache: payload.cache || { hit: false }
  };
}

async function safeResponseJson(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallback;
  }
}

function getDownloadPayload() {
  const result = state.lastResult || makeDemoResult();
  const text = getCurrentCode();
  const output = result.output;
  let extension = "txt";
  let mime = "text/plain";

  if (output === "mermaid") {
    extension = "mmd";
  } else if (output === "markdown") {
    extension = "md";
    mime = "text/markdown";
  } else if (output === "json") {
    extension = "json";
    mime = "application/json";
  } else if (output === "csv") {
    extension = "csv";
    mime = "text/csv";
  }

  return {
    name: `picstruct-${result.mode}.${extension}`,
    mime,
    text
  };
}

async function copyResult() {
  const text = getCurrentCode();

  try {
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  } catch (error) {
    showToast("Copy failed");
  }
}

function downloadResult() {
  const payload = getDownloadPayload();
  const blob = new Blob([payload.text], { type: payload.mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Download started");
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 1900);
}

function getCurrentCode() {
  const text = els.codeEditor?.value || "";
  if (state.lastResult) {
    state.lastResult.code = text;
  }
  return text;
}

function handleEditorInput() {
  if (!state.lastResult) return;

  const text = getCurrentCode();
  window.clearTimeout(state.previewTimer);
  state.previewTimer = window.setTimeout(async () => {
    if (!state.lastResult) return;

    if (state.lastResult.output === "mermaid") {
      state.lastResult.mermaid = text;
      await renderMermaid(text);
    } else if (state.lastResult.output === "csv") {
      state.lastResult.csv = text;
      renderTable(text);
    }
  }, 450);
}

function updateFileMeta(text) {
  if (els.fileMeta) {
    els.fileMeta.textContent = text;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function readHistory() {
  try {
    const items = JSON.parse(localStorage.getItem(historyKey) || "[]");
    return Array.isArray(items) ? items : [];
  } catch (error) {
    return [];
  }
}

function writeHistory(items) {
  localStorage.setItem(historyKey, JSON.stringify(items.slice(0, 6)));
  renderHistory();
}

function saveHistory(result, source) {
  const item = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    source,
    mode: result.mode,
    output: result.output,
    previewType: result.previewType,
    fileName: result.fileName || state.uploadedName || "Untitled",
    code: getCurrentCode() || result.code,
    mermaid: result.mermaid || "",
    csv: result.csv || "",
    data: result.data || "{}",
    metrics: result.metrics,
    summary: result.summary || "",
    warnings: result.warnings || [],
    createdAt: new Date().toISOString()
  };

  const next = [item, ...readHistory()].slice(0, 6);
  writeHistory(next);
}

function restoreHistory(id) {
  const item = readHistory().find((entry) => entry.id === id);
  if (!item) return;

  setMode(item.mode, { keepSample: true, skipRender: true });
  els.outputSelect.value = item.output;
  renderResult({
    mode: item.mode,
    output: item.output,
    detail: "restored",
    fileName: item.fileName,
    previewType: item.previewType,
    code: item.code,
    mermaid: item.mermaid,
    csv: item.csv,
    data: item.data,
    metrics: item.metrics || { nodes: 0, links: 0, confidence: item.source || "Saved" },
    summary: item.summary || "Restored saved output.",
    warnings: item.warnings || []
  });
  setResultView("preview");
  updateFileMeta(`Restored: ${item.fileName}`);
  showToast("Restored recent output");
}

function renderHistory() {
  if (!els.recentList) return;

  const items = readHistory();
  if (!items.length) {
    els.recentList.innerHTML = "<p>No saved outputs yet.</p>";
    return;
  }

  els.recentList.innerHTML = "";
  for (const item of items) {
    const button = document.createElement("button");
    button.className = "recent-item";
    button.type = "button";
    button.dataset.historyId = item.id;

    const copy = document.createElement("span");
    const title = document.createElement("strong");
    const meta = document.createElement("span");
    const chip = document.createElement("span");

    title.textContent = item.fileName || "Untitled";
    meta.textContent = `${item.mode} · ${item.output}`;
    copy.append(title, meta);
    chip.className = "recent-chip";
    chip.textContent = item.source || "Saved";
    button.append(copy, chip);
    els.recentList.appendChild(button);
  }
}

function clearHistory() {
  localStorage.removeItem(historyKey);
  renderHistory();
  showToast("Recent outputs cleared");
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readUsage() {
  try {
    const parsed = JSON.parse(localStorage.getItem(usageKey) || "{}");
    if (parsed.date === todayKey()) {
      return {
        date: parsed.date,
        count: Number(parsed.count || 0),
        limit: Number(parsed.limit || FREE_DAILY_LIMIT)
      };
    }
  } catch (error) {
  }

  return { date: todayKey(), count: 0, limit: FREE_DAILY_LIMIT };
}

function writeUsage(usage) {
  localStorage.setItem(usageKey, JSON.stringify({
    date: usage.date || todayKey(),
    count: Number(usage.count || 0),
    limit: Number(usage.limit || FREE_DAILY_LIMIT)
  }));
  renderUsage();
}

function incrementUsage() {
  const usage = readUsage();
  writeUsage({ date: todayKey(), count: Math.min(usage.limit, usage.count + 1), limit: usage.limit });
}

function syncUsageFromPlan(plan) {
  if (plan?.id !== "free") return;

  const limit = Number(plan.limit || FREE_DAILY_LIMIT);
  const used = Number(plan.used || 0);
  writeUsage({
    date: todayKey(),
    count: Math.min(limit, Math.max(0, used)),
    limit
  });
}

function renderUsage() {
  if (!els.quotaStrip || !els.quotaText) return;

  if (hasPaidAccessCode()) {
    els.quotaText.textContent = "Paid access code saved. Server quota applies.";
    els.quotaStrip.classList.remove("is-low", "is-empty");
    return;
  }

  const usage = readUsage();
  const remaining = Math.max(0, usage.limit - usage.count);
  els.quotaText.textContent = `Free conversions: ${usage.count} / ${usage.limit} today`;
  els.quotaStrip.classList.toggle("is-low", remaining === 1);
  els.quotaStrip.classList.toggle("is-empty", remaining === 0);
}

function showUpgradePanel() {
  if (els.upgradePanel) {
    els.upgradePanel.hidden = false;
  }
}

function hideUpgradePanel() {
  if (els.upgradePanel) {
    els.upgradePanel.hidden = true;
  }
}

function readAccessCode() {
  return String(localStorage.getItem(accessCodeKey) || "").trim();
}

function hasPaidAccessCode() {
  return readAccessCode().length > 0;
}

function saveAccessCode(event) {
  event.preventDefault();
  const code = String(els.accessCodeInput?.value || "").trim();

  if (!code) {
    showToast("Paste an access code");
    return;
  }

  localStorage.setItem(accessCodeKey, code);
  renderUsage();
  renderAccessStatus();
  hideUpgradePanel();
  showToast("Access code saved");
}

function clearAccessCode() {
  localStorage.removeItem(accessCodeKey);
  if (els.accessCodeInput) {
    els.accessCodeInput.value = "";
  }
  renderUsage();
  renderAccessStatus();
  showToast("Access code cleared");
}

function renderAccessStatus(plan) {
  if (!els.accessStatus) return;

  if (plan?.id === "free") {
    const remaining = plan.remaining === null ? "available" : `${plan.remaining} remaining`;
    els.accessStatus.textContent = `Free plan active: ${remaining} today.`;
    els.accessStatus.classList.remove("is-paid");
    return;
  }

  if (plan?.label) {
    const windowLabel = plan.window === "month" ? "monthly" : "daily";
    const remaining = plan.remaining === null ? "unlimited" : `${plan.remaining} remaining`;
    els.accessStatus.textContent = `${plan.label} active: ${remaining} in this ${windowLabel} cycle.`;
    els.accessStatus.classList.add("is-paid");
    return;
  }

  if (hasPaidAccessCode()) {
    els.accessStatus.textContent = "Access code saved. It will be checked on the next AI conversion.";
    els.accessStatus.classList.add("is-paid");
    return;
  }

  els.accessStatus.textContent = "Free plan active. Paid users can paste an access code here.";
  els.accessStatus.classList.remove("is-paid");
}

function setParserStatus(status) {
  if (!els.parserStatus || !els.parserStatusText) return;

  els.parserStatus.classList.remove("is-ai", "is-fallback", "is-demo");
  els.parserStatus.classList.add(`is-${status}`);

  const labels = {
    ai: "AI parser active",
    fallback: "Demo fallback active",
    demo: "Demo parser active"
  };

  els.parserStatusText.textContent = labels[status] || labels.demo;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

els.modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

els.resultTabs.forEach((tab) => {
  tab.addEventListener("click", () => setResultView(tab.dataset.view));
});

els.sampleButtons.forEach((button) => {
  button.addEventListener("click", () => loadSample(button.dataset.sample));
});

els.fileInput.addEventListener("change", (event) => {
  handleFile(event.target.files[0]);
});

els.loadUrlButton.addEventListener("click", loadImageUrl);
els.imageUrlInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    loadImageUrl();
  }
});

els.dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropzone.classList.add("is-dragover");
});

els.dropzone.addEventListener("dragleave", () => {
  els.dropzone.classList.remove("is-dragover");
});

els.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropzone.classList.remove("is-dragover");
  handleFile(event.dataTransfer.files[0]);
});

els.outputSelect.addEventListener("change", () => renderResult(makeDemoResult()));
els.detailSelect.addEventListener("change", () => renderResult(makeDemoResult()));
els.presetSelect.addEventListener("change", () => renderResult(makeDemoResult()));
els.instructionInput.addEventListener("change", () => renderResult(makeDemoResult()));
els.generateButton.addEventListener("click", handleGenerate);
els.copyButton.addEventListener("click", copyResult);
els.downloadButton.addEventListener("click", downloadResult);
els.codeEditor.addEventListener("input", handleEditorInput);
els.clearHistoryButton.addEventListener("click", clearHistory);
els.dismissUpgradeButton.addEventListener("click", hideUpgradePanel);
if (els.accessForm) {
  els.accessForm.addEventListener("submit", saveAccessCode);
}
if (els.clearAccessCodeButton) {
  els.clearAccessCodeButton.addEventListener("click", clearAccessCode);
}
document.querySelectorAll("[data-checkout-plan]").forEach((button) => {
  button.addEventListener("click", () => openCheckout(button.dataset.checkoutPlan));
});
els.recentList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-history-id]");
  if (item) restoreHistory(item.dataset.historyId);
});

window.addEventListener("picstruct:mermaid-ready", () => {
  if (state.lastResult?.previewType === "mermaid") {
    renderMermaid(state.lastResult.mermaid);
  }
});

renderResult(makeDemoResult());
renderHistory();
renderUsage();
renderAccessStatus();

function openCheckout(plan) {
  if (plan === "free") {
    showToast("Free plan is active");
    return;
  }

  const config = window.PICSTRUCT_CONFIG || {};
  if (config.checkoutMode === "direct") {
    const urlMap = {
      starter: config.starterCheckoutUrl,
      pro: config.proCheckoutUrl,
      credits: config.creditPackCheckoutUrl
    };
    const checkoutUrl = urlMap[plan];

    if (checkoutUrl) {
      window.location.href = checkoutUrl;
      return;
    }
  }

  window.location.href = `checkout.html?plan=${encodeURIComponent(plan || "starter")}`;
}
