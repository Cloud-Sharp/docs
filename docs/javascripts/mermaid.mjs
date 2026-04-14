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
    return getColorScheme() === "slate" ? "dark" : "light";
  }

  function getThemeVariables(theme) {
    if (theme === "dark") {
      return {
        darkMode: true,
        background: "#101922",
        primaryColor: "#22303d",
        primaryTextColor: "#edf6fc",
        primaryBorderColor: "#7ec3e7",
        secondaryColor: "#19242e",
        secondaryTextColor: "#edf6fc",
        tertiaryColor: "#2a3947",
        tertiaryTextColor: "#edf6fc",
        lineColor: "#7ec3e7",
        textColor: "#edf6fc",
        mainBkg: "#22303d",
        nodeBorder: "#7ec3e7",
        clusterBkg: "#17212a",
        clusterBorder: "#4c6476",
        edgeLabelBackground: "#1b2731",
        actorBkg: "#22303d",
        actorBorder: "#7ec3e7",
        actorTextColor: "#edf6fc",
        labelBoxBkgColor: "#22303d",
        labelBoxBorderColor: "#7ec3e7",
        labelTextColor: "#edf6fc",
        signalColor: "#edf6fc",
        signalTextColor: "#edf6fc",
        noteBkgColor: "#2b3845",
        noteTextColor: "#edf6fc",
        noteBorderColor: "#6c8798",
        activationBkgColor: "#263441",
        activationBorderColor: "#7ec3e7",
        fontFamily: "var(--md-text-font-family, sans-serif)",
      };
    }

    return {
      darkMode: false,
      background: "#ffffff",
      primaryColor: "#edf5fb",
      primaryTextColor: "#14212b",
      primaryBorderColor: "#5f7f96",
      secondaryColor: "#ffffff",
      secondaryTextColor: "#14212b",
      tertiaryColor: "#e7f0f7",
      tertiaryTextColor: "#14212b",
      lineColor: "#5f7f96",
      textColor: "#14212b",
      mainBkg: "#edf5fb",
      nodeBorder: "#5f7f96",
      clusterBkg: "#f4f8fb",
      clusterBorder: "#b8cad8",
      edgeLabelBackground: "#f4f8fb",
      actorBkg: "#edf5fb",
      actorBorder: "#5f7f96",
      actorTextColor: "#14212b",
      labelBoxBkgColor: "#f4f8fb",
      labelBoxBorderColor: "#b8cad8",
      labelTextColor: "#14212b",
      signalColor: "#14212b",
      signalTextColor: "#14212b",
      noteBkgColor: "#eef6dc",
      noteTextColor: "#14212b",
      noteBorderColor: "#9fb86b",
      activationBkgColor: "#e7f0f7",
      activationBorderColor: "#8ea8bb",
      fontFamily: "var(--md-text-font-family, sans-serif)",
    };
  }

  function configureMermaid() {
    const theme = getMermaidTheme();

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme: "base",
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

    let toolbar = target.querySelector(":scope > .mermaid-host__toolbar");
    let host = target.querySelector(":scope > .mermaid-host__svg");

    if (!host || !toolbar) {
      target.innerHTML = "";

      toolbar = document.createElement("div");
      toolbar.className = "mermaid-host__toolbar";
      target.appendChild(toolbar);

      host = document.createElement("div");
      host.className = "mermaid-host__svg";
      target.appendChild(host);
    }

    return host;
  }

  function resetPanzoom(target) {
    const instance = target.__mermaidPanzoom;
    const initialTransform = target.__mermaidInitialTransform;

    if (!instance || !initialTransform) {
      return;
    }

    instance.zoomAbs(0, 0, initialTransform.scale);
    instance.moveTo(initialTransform.x, initialTransform.y);
  }

  function cloneTransform(transform) {
    if (!transform) {
      return null;
    }

    return {
      x: transform.x,
      y: transform.y,
      scale: transform.scale,
    };
  }

  function isFullscreenTarget(target) {
    return document.fullscreenElement === target;
  }

  async function toggleFullscreen(target) {
    try {
      if (isFullscreenTarget(target)) {
        await document.exitFullscreen();
      } else if (typeof target.requestFullscreen === "function") {
        await target.requestFullscreen();
      }
    } catch (error) {
      console.error("[mermaid] Failed to toggle fullscreen.", error);
    }

    updateToolbarButtons(target);
  }

  function updateToolbarButtons(target) {
    const toolbar = target.querySelector(":scope > .mermaid-host__toolbar");

    if (!toolbar) {
      return;
    }

    const fullscreenButton = toolbar.querySelector(':scope > [data-role="fullscreen"]');

    if (fullscreenButton) {
      const active = isFullscreenTarget(target);
      fullscreenButton.textContent = active ? "전체화면 종료" : "전체화면";
      fullscreenButton.title = active ? "전체화면 보기 종료" : "다이어그램을 전체화면으로 보기";
    }
  }

  function ensureToolbarButtons(target) {
    const toolbar = target.querySelector(":scope > .mermaid-host__toolbar");

    if (!toolbar) {
      return;
    }

    let resetButton = toolbar.querySelector(':scope > [data-role="reset"]');

    if (!resetButton) {
      resetButton = document.createElement("button");
      resetButton.type = "button";
      resetButton.className = "mermaid-host__button";
      resetButton.dataset.role = "reset";
      toolbar.appendChild(resetButton);
    }

    resetButton.textContent = "초기 위치";
    resetButton.title = "다이어그램의 초기 위치와 배율로 되돌리기";

    resetButton.onclick = function () {
      resetPanzoom(target);
    };

    let fullscreenButton = toolbar.querySelector(':scope > [data-role="fullscreen"]');

    if (!fullscreenButton) {
      fullscreenButton = document.createElement("button");
      fullscreenButton.type = "button";
      fullscreenButton.className = "mermaid-host__button";
      fullscreenButton.dataset.role = "fullscreen";
      toolbar.appendChild(fullscreenButton);
    }

    fullscreenButton.onclick = function () {
      toggleFullscreen(target);
    };

    if (!target.__mermaidFullscreenChangeHandler) {
      target.__mermaidFullscreenChangeHandler = function () {
        updateToolbarButtons(target);
      };
      document.addEventListener("fullscreenchange", target.__mermaidFullscreenChangeHandler);
    }

    updateToolbarButtons(target);
  }

  function attachPanzoom(target, host) {
    if (typeof window.panzoom !== "function") {
      ensureToolbarButtons(target);
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
    target.__mermaidInitialTransform = cloneTransform(instance.getTransform());
    ensureToolbarButtons(target);
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
