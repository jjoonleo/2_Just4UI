const extractButton = document.getElementById("extractButton");
const includeScreenshot = document.getElementById("includeScreenshot");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const copyButton = document.getElementById("copyButton");
const downloadButton = document.getElementById("downloadButton");
const textCountEl = document.getElementById("textCount");
const interactiveCountEl = document.getElementById("interactiveCount");
const formCountEl = document.getElementById("formCount");
const imageCountEl = document.getElementById("imageCount");

let latestSnapshotJson = "";

extractButton.addEventListener("click", extractCurrentPage);
copyButton.addEventListener("click", copySnapshot);
downloadButton.addEventListener("click", downloadSnapshot);

async function extractCurrentPage() {
  setBusy(true);
  setStatus("Extracting page snapshot...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageSnapshot
    });

    const snapshot = result;
    if (includeScreenshot.checked) {
      setStatus("Capturing visible screenshot...");
      snapshot.visualSnapshot = {
        kind: "visibleViewportScreenshot",
        format: "png",
        dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      };
    }

    latestSnapshotJson = JSON.stringify(snapshot, null, 2);
    outputEl.value = latestSnapshotJson;
    updateSummary(snapshot);
    copyButton.disabled = false;
    downloadButton.disabled = false;
    setStatus("Snapshot extracted.");
  } catch (error) {
    latestSnapshotJson = "";
    outputEl.value = "";
    copyButton.disabled = true;
    downloadButton.disabled = true;
    updateSummary(null);
    setStatus(error.message || "Failed to extract snapshot.", true);
  } finally {
    setBusy(false);
  }
}

async function copySnapshot() {
  if (!latestSnapshotJson) return;
  await navigator.clipboard.writeText(latestSnapshotJson);
  setStatus("Snapshot JSON copied.");
}

function downloadSnapshot() {
  if (!latestSnapshotJson) return;

  const blob = new Blob([latestSnapshotJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `page-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Snapshot JSON downloaded.");
}

function setBusy(isBusy) {
  extractButton.disabled = isBusy;
  extractButton.textContent = isBusy ? "Extracting..." : "Extract current page";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function updateSummary(snapshot) {
  textCountEl.textContent = String(snapshot?.content?.textBlocks?.length || 0);
  interactiveCountEl.textContent = String(snapshot?.content?.interactiveElements?.length || 0);
  formCountEl.textContent = String(snapshot?.content?.forms?.length || 0);
  imageCountEl.textContent = String(snapshot?.content?.images?.length || 0);
}

function collectPageSnapshot() {
  const MAX_TEXT_BLOCKS = 300;
  const MAX_INTERACTIVE_ELEMENTS = 250;
  const MAX_IMAGES = 150;
  const MAX_LINKS = 250;
  const MAX_TABLES = 50;
  const MAX_LISTS = 80;
  const MAX_OPTIONS = 30;
  const MAX_TEXT_LENGTH = 600;

  const interactiveSelector = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role]",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']"
  ].join(",");

  const textBlockSelector = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "blockquote",
    "figcaption",
    "caption",
    "label",
    "legend",
    "dt",
    "dd",
    "th",
    "td",
    "[role='heading']",
    "[aria-label]"
  ].join(",");

  const pageUrl = location.href;

  return {
    schemaVersion: "0.1.0",
    collectedAt: new Date().toISOString(),
    privacy: {
      userTriggered: true,
      formValuesIncluded: false,
      automaticRetention: false,
      screenshotIncluded: false
    },
    page: {
      url: pageUrl,
      origin: location.origin,
      title: document.title,
      language: document.documentElement.lang || null,
      direction: document.documentElement.dir || getComputedStyle(document.documentElement).direction || null,
      charset: document.characterSet || null,
      canonicalUrl: getCanonicalUrl(),
      metaDescription: getMeta("description"),
      metaRobots: getMeta("robots")
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight
    },
    content: {
      landmarks: collectLandmarks(),
      headings: collectHeadings(),
      textBlocks: collectTextBlocks(),
      interactiveElements: collectInteractiveElements(),
      forms: collectForms(),
      links: collectLinks(),
      images: collectImages(),
      media: collectMedia(),
      tables: collectTables(),
      lists: collectLists(),
      dialogs: collectDialogs(),
      liveRegions: collectLiveRegions()
    }
  };

  function collectLandmarks() {
    const selectors = [
      "header",
      "nav",
      "main",
      "aside",
      "footer",
      "section",
      "article",
      "form",
      "[role='banner']",
      "[role='navigation']",
      "[role='main']",
      "[role='complementary']",
      "[role='contentinfo']",
      "[role='search']",
      "[role='region']"
    ].join(",");

    return Array.from(document.querySelectorAll(selectors)).slice(0, 120).map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: getRole(element),
      label: getAccessibleName(element),
      textPreview: truncate(normalizeText(element.innerText || element.textContent || ""), 220),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectHeadings() {
    return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")).slice(0, 120).map((element) => ({
      level: getHeadingLevel(element),
      text: truncate(getElementText(element), MAX_TEXT_LENGTH),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectTextBlocks() {
    return Array.from(document.querySelectorAll(textBlockSelector))
      .filter((element) => isVisible(element))
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: getRole(element),
        text: truncate(getElementText(element) || getAccessibleName(element), MAX_TEXT_LENGTH),
        selector: getCssPath(element),
        bounds: getBounds(element),
        importance: inferImportance(element)
      }))
      .filter((item) => item.text)
      .slice(0, MAX_TEXT_BLOCKS);
  }

  function collectInteractiveElements() {
    return Array.from(document.querySelectorAll(interactiveSelector))
      .filter((element) => isVisible(element))
      .map((element, index) => {
        const type = getInputType(element);
        return {
          snapshotId: `interactive-${index + 1}`,
          tag: element.tagName.toLowerCase(),
          role: getRole(element),
          type,
          name: getNameAttribute(element),
          label: getAccessibleName(element),
          text: truncate(getElementText(element), MAX_TEXT_LENGTH),
          href: element instanceof HTMLAnchorElement ? normalizeUrl(element.href) : null,
          disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
          required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
          checked: isCheckable(element) ? Boolean(element.checked || element.getAttribute("aria-checked") === "true") : null,
          expanded: getNullableAttribute(element, "aria-expanded"),
          hasPopup: getNullableAttribute(element, "aria-haspopup"),
          controls: getNullableAttribute(element, "aria-controls"),
          describedBy: getDescribedByText(element),
          placeholder: isFormControl(element) ? element.getAttribute("placeholder") || null : null,
          valueIncluded: false,
          selector: getCssPath(element),
          bounds: getBounds(element),
          visible: true
        };
      })
      .slice(0, MAX_INTERACTIVE_ELEMENTS);
  }

  function collectForms() {
    return Array.from(document.forms).map((form, index) => ({
      snapshotId: `form-${index + 1}`,
      label: getAccessibleName(form),
      selector: getCssPath(form),
      method: (form.getAttribute("method") || "get").toLowerCase(),
      actionOrigin: safeOrigin(form.action),
      bounds: getBounds(form),
      visible: isVisible(form),
      fields: Array.from(form.querySelectorAll("input, select, textarea, button")).map((field, fieldIndex) => ({
        snapshotId: `form-${index + 1}-field-${fieldIndex + 1}`,
        tag: field.tagName.toLowerCase(),
        type: getInputType(field),
        name: getNameAttribute(field),
        label: getAccessibleName(field),
        placeholder: field.getAttribute("placeholder") || null,
        autocomplete: field.getAttribute("autocomplete") || null,
        required: Boolean(field.required || field.getAttribute("aria-required") === "true"),
        disabled: Boolean(field.disabled || field.getAttribute("aria-disabled") === "true"),
        readonly: Boolean(field.readOnly),
        options: field instanceof HTMLSelectElement ? collectSelectOptions(field) : null,
        valueIncluded: false,
        selector: getCssPath(field),
        bounds: getBounds(field),
        visible: isVisible(field)
      }))
    }));
  }

  function collectLinks() {
    return Array.from(document.links)
      .filter((link) => isVisible(link))
      .map((link) => ({
        text: truncate(getElementText(link) || getAccessibleName(link), MAX_TEXT_LENGTH),
        href: normalizeUrl(link.href),
        sameOrigin: safeOrigin(link.href) === location.origin,
        target: link.target || null,
        selector: getCssPath(link),
        bounds: getBounds(link)
      }))
      .filter((link) => link.text || link.href)
      .slice(0, MAX_LINKS);
  }

  function collectImages() {
    return Array.from(document.images)
      .filter((image) => isVisible(image))
      .map((image) => ({
        alt: image.alt || null,
        title: image.title || null,
        src: normalizeUrl(image.currentSrc || image.src),
        loading: image.loading || null,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        displayedWidth: image.width,
        displayedHeight: image.height,
        selector: getCssPath(image),
        bounds: getBounds(image)
      }))
      .slice(0, MAX_IMAGES);
  }

  function collectMedia() {
    return Array.from(document.querySelectorAll("audio, video")).slice(0, 80).map((element) => ({
      tag: element.tagName.toLowerCase(),
      controls: Boolean(element.controls),
      autoplay: Boolean(element.autoplay),
      muted: Boolean(element.muted),
      duration: Number.isFinite(element.duration) ? element.duration : null,
      label: getAccessibleName(element),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectTables() {
    return Array.from(document.querySelectorAll("table")).slice(0, MAX_TABLES).map((table, index) => {
      const headers = Array.from(table.querySelectorAll("th")).map((cell) => truncate(getElementText(cell), 120)).filter(Boolean).slice(0, 30);
      return {
        snapshotId: `table-${index + 1}`,
        caption: getElementText(table.querySelector("caption")),
        headers,
        rowCount: table.rows.length,
        columnEstimate: Math.max(0, ...Array.from(table.rows).map((row) => row.cells.length)),
        selector: getCssPath(table),
        bounds: getBounds(table),
        visible: isVisible(table)
      };
    });
  }

  function collectLists() {
    return Array.from(document.querySelectorAll("ul,ol,[role='list']")).slice(0, MAX_LISTS).map((list, index) => ({
      snapshotId: `list-${index + 1}`,
      tag: list.tagName.toLowerCase(),
      role: getRole(list),
      itemCount: list.querySelectorAll(":scope > li, :scope > [role='listitem']").length,
      textPreview: truncate(getElementText(list), 300),
      selector: getCssPath(list),
      bounds: getBounds(list),
      visible: isVisible(list)
    }));
  }

  function collectDialogs() {
    return Array.from(document.querySelectorAll("dialog,[role='dialog'],[role='alertdialog']")).slice(0, 40).map((dialog) => ({
      role: getRole(dialog),
      label: getAccessibleName(dialog),
      textPreview: truncate(getElementText(dialog), 500),
      open: dialog instanceof HTMLDialogElement ? dialog.open : null,
      selector: getCssPath(dialog),
      bounds: getBounds(dialog),
      visible: isVisible(dialog)
    }));
  }

  function collectLiveRegions() {
    return Array.from(document.querySelectorAll("[aria-live],[role='alert'],[role='status']")).slice(0, 40).map((element) => ({
      role: getRole(element),
      ariaLive: getNullableAttribute(element, "aria-live"),
      text: truncate(getElementText(element), 500),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectSelectOptions(select) {
    return Array.from(select.options).slice(0, MAX_OPTIONS).map((option) => ({
      text: truncate(normalizeText(option.textContent || ""), 160),
      disabled: option.disabled
    }));
  }

  function getAccessibleName(element) {
    if (!element) return null;

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return truncate(normalizeText(ariaLabel), MAX_TEXT_LENGTH);

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => getElementText(node))
        .join(" ");
      if (text) return truncate(normalizeText(text), MAX_TEXT_LENGTH);
    }

    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) return truncate(getElementText(label), MAX_TEXT_LENGTH);
    }

    const wrappingLabel = element.closest("label");
    if (wrappingLabel) return truncate(getElementText(wrappingLabel), MAX_TEXT_LENGTH);

    const title = element.getAttribute("title");
    if (title) return truncate(normalizeText(title), MAX_TEXT_LENGTH);

    const alt = element.getAttribute("alt");
    if (alt) return truncate(normalizeText(alt), MAX_TEXT_LENGTH);

    return null;
  }

  function getDescribedByText(element) {
    const describedBy = element.getAttribute("aria-describedby");
    if (!describedBy) return null;

    const text = describedBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => getElementText(node))
      .join(" ");

    return text ? truncate(normalizeText(text), MAX_TEXT_LENGTH) : null;
  }

  function getElementText(element) {
    if (!element) return "";
    return normalizeText(element.innerText || element.textContent || "");
  }

  function getRole(element) {
    return element.getAttribute("role") || inferNativeRole(element);
  }

  function inferNativeRole(element) {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "header") return "banner";
    if (tag === "footer") return "contentinfo";
    if (tag === "aside") return "complementary";
    if (tag === "form") return "form";
    if (tag === "ul" || tag === "ol") return "list";
    if (tag === "li") return "listitem";
    if (tag === "table") return "table";
    if (tag === "input") return inferInputRole(element);
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    return null;
  }

  function inferInputRole(input) {
    const type = getInputType(input);
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    return "textbox";
  }

  function getHeadingLevel(element) {
    const ariaLevel = Number(element.getAttribute("aria-level"));
    if (Number.isInteger(ariaLevel) && ariaLevel > 0) return ariaLevel;
    const match = element.tagName.match(/^H([1-6])$/i);
    return match ? Number(match[1]) : null;
  }

  function inferImportance(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "h1") return "pageTitle";
    if (tag === "h2" || tag === "h3" || element.getAttribute("role") === "heading") return "sectionHeading";
    if (element.closest("nav")) return "navigation";
    if (element.closest("main")) return "mainContent";
    if (element.closest("footer")) return "footer";
    return "content";
  }

  function getInputType(element) {
    return element.getAttribute("type") || (element.tagName.toLowerCase() === "input" ? "text" : null);
  }

  function getNameAttribute(element) {
    return element.getAttribute("name") || null;
  }

  function getNullableAttribute(element, attribute) {
    return element.hasAttribute(attribute) ? element.getAttribute(attribute) : null;
  }

  function isFormControl(element) {
    return element.matches("input, select, textarea");
  }

  function isCheckable(element) {
    const type = getInputType(element);
    return type === "checkbox" || type === "radio" || element.getAttribute("role") === "checkbox" || element.getAttribute("role") === "radio";
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function getBounds(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      left: round(rect.left),
      inViewport: rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth
    };
  }

  function getCssPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (element.id) return `#${cssEscape(element.id)}`;

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const classNames = Array.from(current.classList).slice(0, 2);
      if (classNames.length) {
        part += `.${classNames.map(cssEscape).join(".")}`;
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (sameTagSiblings.length > 1) {
          part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      if (parts.length >= 5) break;
      current = parent;
    }

    return parts.join(" > ");
  }

  function getCanonicalUrl() {
    const canonical = document.querySelector("link[rel='canonical']");
    return canonical ? normalizeUrl(canonical.href) : null;
  }

  function getMeta(name) {
    const meta = document.querySelector(`meta[name='${name}'], meta[property='${name}']`);
    return meta?.getAttribute("content") || null;
  }

  function normalizeUrl(url) {
    if (!url) return null;
    try {
      return new URL(url, pageUrl).href;
    } catch {
      return url;
    }
  }

  function safeOrigin(url) {
    if (!url) return null;
    try {
      return new URL(url, pageUrl).origin;
    } catch {
      return null;
    }
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function truncate(text, maxLength) {
    const normalized = normalizeText(text);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
}
