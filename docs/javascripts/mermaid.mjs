import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.14.0/dist/mermaid.esm.min.mjs";
import elkLayouts from "https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@0.2.1/dist/mermaid-layout-elk.esm.min.mjs";

if (!window.__mkdocsMermaidElkRegistered) {
  mermaid.registerLayoutLoaders(elkLayouts);
  window.__mkdocsMermaidElkRegistered = true;
}

(function () {
  if (window.__mkdocsMermaidInit) {
    return;
  }

  window.__mkdocsMermaidInit = true;

  const SOURCE_SELECTOR = [
    ".md-typeset pre.mermaid-source",
    ".md-typeset pre > code.language-mermaid",
    ".md-typeset pre > code.mermaid",
  ].join(", ");

  let renderCount = 0;
  let lastTheme = null;
  let themeObserverInstalled = false;

  function getPanzoomKeyPressed(event) {
    return event.ctrlKey || event.metaKey;
  }

  function getColorScheme() {
    return (
      document.body?.getAttribute("data-md-color-scheme") ||
      document.documentElement.getAttribute("data-md-color-scheme") ||
      "default"
    );
  }

  function getMermaidTheme() {
    return getColorScheme() === "slate" ? "dark" : "default";
  }

  function getThemeVariables(theme) {
    if (theme === "dark") {
      return {
        background: "#0f1115",
        primaryColor: "#8d6e63",
        primaryTextColor: "#f5f5f5",
        primaryBorderColor: "#d7ccc8",
        lineColor: "#d7ccc8",
        secondaryColor: "#1b1f24",
        tertiaryColor: "#232831",
        clusterBkg: "#181c22",
        clusterBorder: "#9e8b83",
        fontFamily: "var(--md-text-font-family, sans-serif)",
      };
    }

    return {
      background: "#ffffff",
      primaryColor: "#8d6e63",
      primaryTextColor: "#1f1f1f",
      primaryBorderColor: "#6d4c41",
      lineColor: "#6d4c41",
      secondaryColor: "#f7f3f0",
      tertiaryColor: "#efe7e2",
      clusterBkg: "#f7f3f0",
      clusterBorder: "#a1887f",
      fontFamily: "var(--md-text-font-family, sans-serif)",
    };
  }

  function configureMermaid() {
    const theme = getMermaidTheme();

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme,
      layout: "elk",
      htmlLabels: true,
      themeVariables: getThemeVariables(theme),
      elk: {
        mergeEdges: false,
      },
      flowchart: {
        useMaxWidth: true,
        defaultRenderer: "elk",
      },
      state: {
        defaultRenderer: "elk",
      },
      class: {
        defaultRenderer: "elk",
      },
      sequence: {
        useMaxWidth: true,
      },
      er: {
        useMaxWidth: true,
      },
    });

    lastTheme = theme;
    return true;
  }

  function getTargets(root) {
    const targets = new Set();

    for (const node of root.querySelectorAll(".md-typeset [data-mermaid-source]")) {
      targets.add(node);
    }

    for (const node of root.querySelectorAll(SOURCE_SELECTOR)) {
      const target = node.tagName === "CODE" ? node.parentElement : node;

      if (!target) {
        continue;
      }

      targets.add(target);
    }

    return Array.from(targets);
  }

  function getSource(target) {
    if (target.dataset.mermaidSource) {
      return target.dataset.mermaidSource;
    }

    const code = target.querySelector("code");
    const source = normalizeSource(code ? code.textContent : target.textContent || "");
    target.dataset.mermaidSource = source;
    return source;
  }

  function normalizeSource(source) {
    return String(source || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\uFEFF/g, "")
      .replace(/[\u00A0\u2007\u202F]/g, " ")
      .trim();
  }

  function stripFrontmatter(source) {
    if (!source.startsWith("---")) {
      return source;
    }

    const lines = source.split("\n");
    let i = 1;

    while (i < lines.length) {
      if (lines[i].trim() === "---") {
        return lines.slice(i + 1).join("\n").trim();
      }

      i += 1;
    }

    return source;
  }

  function detectDiagramType(source) {
    const body = stripFrontmatter(source);
    const firstLine = body
      .split("\n")
      .map(function (line) {
        return line.trim();
      })
      .find(Boolean);

    if (!firstLine) {
      return null;
    }

    const match = firstLine.match(
      /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|requirementDiagram|requirement|quadrantChart|sankey-beta|xychart-beta|block-beta|packet-beta|architecture-beta|kanban)\b/
    );

    return match ? match[1] : null;
  }

  function applyPerDiagramConfig(source) {
    if (!source) {
      return source;
    }

    if (source.startsWith("---")) {
      return source;
    }

    if (/^erDiagram\b/m.test(source)) {
      return ["---", "config:", "  layout: elk", "---", source].join("\n");
    }

    return source;
  }

  function ensureRenderHost(target) {
    target.classList.remove("mermaid");
    target.classList.remove("mermaid-source");
    target.classList.add("mermaid-host");

    let host = target.querySelector(":scope > .mermaid-host__svg");

    if (!host) {
      target.innerHTML = "";
      host = document.createElement("div");
      host.className = "mermaid-host__svg";
      target.appendChild(host);
    }

    return host;
  }

  function attachPanzoom(target, host) {
    if (typeof window.panzoom !== "function") {
      return;
    }

    if (target.__mermaidWheelHost && target.__mermaidWheelHandler) {
      target.__mermaidWheelHost.removeEventListener("wheel", target.__mermaidWheelHandler);
      target.__mermaidWheelHost = null;
      target.__mermaidWheelHandler = null;
    }

    if (target.__mermaidPanzoom && typeof target.__mermaidPanzoom.dispose === "function") {
      target.__mermaidPanzoom.dispose();
    }

    const svg = host.querySelector("svg");

    if (!svg) {
      return;
    }

    const instance = window.panzoom(svg, {
      maxZoom: 6,
      minZoom: 0.5,
      smoothScroll: false,
      zoomDoubleClickSpeed: 1,
      beforeWheel: function (event) {
        return !getPanzoomKeyPressed(event);
      },
    });

    const parent = svg.parentElement;

    if (parent) {
      const wheelHandler = function (event) {
        if (!getPanzoomKeyPressed(event)) {
          return;
        }

        event.preventDefault();
      };

      parent.addEventListener("wheel", wheelHandler, { passive: false });
      target.__mermaidWheelHost = parent;
      target.__mermaidWheelHandler = wheelHandler;
    }

    target.__mermaidPanzoom = instance;
  }

  async function renderTarget(target) {
    const originalSource = getSource(target);
    const diagramType = detectDiagramType(originalSource);

    if (!diagramType || originalSource.startsWith("#mermaid-diagram-")) {
      target.dataset.mermaidRendered = "skipped";
      return;
    }

    const source = applyPerDiagramConfig(originalSource);

    if (!source) {
      return;
    }

    const host = ensureRenderHost(target);
    target.dataset.mermaidRendered = "pending";

    try {
      renderCount += 1;
      const id = "mermaid-diagram-" + renderCount;
      const result = await mermaid.render(id, source);

      host.innerHTML = result.svg;
      attachPanzoom(target, host);
      target.dataset.mermaidRendered = "true";
      target.classList.remove("mermaid-error");

      if (typeof result.bindFunctions === "function") {
        result.bindFunctions(host);
      }
    } catch (error) {
      host.textContent = originalSource;
      target.dataset.mermaidRendered = "error";
      target.classList.add("mermaid-error");
      console.error("[mermaid] Failed to render diagram.", error);
    }
  }

  async function renderAll(root) {
    if (!configureMermaid()) {
      return;
    }

    for (const target of getTargets(root)) {
      await renderTarget(target);
    }
  }

  function rerenderForThemeChange() {
    const theme = getMermaidTheme();

    if (theme === lastTheme) {
      return;
    }

    renderAll(document);
  }

  function installThemeObserver() {
    if (themeObserverInstalled) {
      return;
    }

    const observer = new MutationObserver(rerenderForThemeChange);
    const nodes = [document.documentElement, document.body].filter(Boolean);

    for (const node of nodes) {
      observer.observe(node, {
        attributes: true,
        attributeFilter: ["data-md-color-scheme"],
      });
    }

    themeObserverInstalled = true;
  }

  function init() {
    renderAll(document);
    installThemeObserver();
  }

  if (typeof document$ !== "undefined" && document$) {
    document$.subscribe(function () {
      renderAll(document);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
