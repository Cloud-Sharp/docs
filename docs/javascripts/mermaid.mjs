(function () {
  if (window.__mkdocsMermaidInit) {
    return;
  }

  window.__mkdocsMermaidInit = true;

  const MERMAID_SELECTOR = [
    ".md-typeset pre.mermaid",
    ".md-typeset div.mermaid",
    ".md-typeset pre > code.language-mermaid",
    ".md-typeset pre > code.mermaid",
  ].join(", ");

  let renderCount = 0;
  let lastTheme = null;
  let themeObserverInstalled = false;

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
    if (!window.mermaid) {
      console.warn("[mermaid] Mermaid runtime is not loaded.");
      return false;
    }

    const theme = getMermaidTheme();

    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      theme,
      themeVariables: getThemeVariables(theme),
      flowchart: {
        htmlLabels: true,
        useMaxWidth: true,
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
    const targets = [];
    const seen = new Set();

    for (const node of root.querySelectorAll(MERMAID_SELECTOR)) {
      const target = node.tagName === "CODE" ? node.parentElement : node;

      if (!target || seen.has(target)) {
        continue;
      }

      seen.add(target);
      targets.push(target);
    }

    return targets;
  }

  function getSource(target) {
    if (target.dataset.mermaidSource) {
      return target.dataset.mermaidSource;
    }

    const code = target.querySelector("code");
    const source = (code ? code.textContent : target.textContent || "").trim();
    target.dataset.mermaidSource = source;
    return source;
  }

  async function renderTarget(target) {
    const source = getSource(target);

    if (!source) {
      return;
    }

    target.classList.add("mermaid");
    target.dataset.mermaidRendered = "pending";

    try {
      renderCount += 1;
      const id = "mermaid-diagram-" + renderCount;
      const result = await window.mermaid.render(id, source);

      target.innerHTML = result.svg;
      target.dataset.mermaidRendered = "true";
      target.classList.remove("mermaid-error");

      if (typeof result.bindFunctions === "function") {
        result.bindFunctions(target);
      }
    } catch (error) {
      target.textContent = source;
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
