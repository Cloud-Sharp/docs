(function () {
  if (window.__mkdocsTableFullscreenInit) {
    return;
  }

  window.__mkdocsTableFullscreenInit = true;

  const TABLE_SELECTOR = ".md-typeset table";
  const SKIP_SELECTOR = [
    ".table-fullscreen-overlay",
    ".mermaid-host",
    ".mermaid-source",
    ".redoc",
    ".redoc-container",
    "redoc",
    ".swagger-ui",
    "pre",
    "code",
  ].join(", ");

  let overlayElements = null;

  function shouldSkipTable(table) {
    return Boolean(table.closest(SKIP_SELECTOR));
  }

  function getDisplayNode(table) {
    return (
      table.closest(".md-typeset__scrollwrap") ||
      table.closest(".md-typeset__table") ||
      table
    );
  }

  function ensureOverlay() {
    if (overlayElements) {
      return overlayElements;
    }

    const overlay = document.createElement("div");
    overlay.className = "table-fullscreen-overlay";
    overlay.hidden = true;

    const backdrop = document.createElement("div");
    backdrop.className = "table-fullscreen-overlay__backdrop";
    overlay.appendChild(backdrop);

    const dialog = document.createElement("div");
    dialog.className = "table-fullscreen-overlay__dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "표 전체화면 보기");
    overlay.appendChild(dialog);

    const toolbar = document.createElement("div");
    toolbar.className = "table-fullscreen-overlay__toolbar";
    dialog.appendChild(toolbar);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "table-fullscreen-overlay__close";
    closeButton.textContent = "닫기";
    closeButton.setAttribute("aria-label", "표 전체화면 닫기");
    toolbar.appendChild(closeButton);

    const viewport = document.createElement("div");
    viewport.className = "table-fullscreen-overlay__viewport";
    viewport.tabIndex = -1;
    dialog.appendChild(viewport);

    const tableWrap = document.createElement("div");
    tableWrap.className = "table-fullscreen-overlay__table-wrap";
    viewport.appendChild(tableWrap);

    function closeOverlay() {
      if (overlay.hidden) {
        return;
      }

      overlay.hidden = true;
      tableWrap.replaceChildren();
      document.body.classList.remove("table-fullscreen-open");

      if (overlayElements.previousBodyOverflow !== undefined) {
        document.body.style.overflow = overlayElements.previousBodyOverflow;
      } else {
        document.body.style.removeProperty("overflow");
      }

      if (overlayElements.activeTrigger && typeof overlayElements.activeTrigger.focus === "function") {
        overlayElements.activeTrigger.focus();
      }

      overlayElements.activeTrigger = null;
    }

    function openOverlay(table, trigger) {
      const clone = table.cloneNode(true);
      tableWrap.replaceChildren(clone);

      overlayElements.previousBodyOverflow = document.body.style.overflow;
      document.body.classList.add("table-fullscreen-open");
      document.body.style.overflow = "hidden";
      overlay.hidden = false;
      overlayElements.activeTrigger = trigger || null;

      requestAnimationFrame(function () {
        closeButton.focus();
      });
    }

    backdrop.addEventListener("click", closeOverlay);
    closeButton.addEventListener("click", closeOverlay);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !overlay.hidden) {
        closeOverlay();
      }
    });

    document.body.appendChild(overlay);

    overlayElements = {
      overlay: overlay,
      tableWrap: tableWrap,
      closeOverlay: closeOverlay,
      openOverlay: openOverlay,
      activeTrigger: null,
      previousBodyOverflow: undefined,
    };

    return overlayElements;
  }

  function ensureHost(table) {
    const displayNode = getDisplayNode(table);
    let host = displayNode.parentElement;

    if (!host || !host.classList.contains("table-fullscreen-host")) {
      host = document.createElement("div");
      host.className = "table-fullscreen-host";
      displayNode.parentNode.insertBefore(host, displayNode);
      host.appendChild(displayNode);
    }

    host.dataset.tableFullscreenInitialized = "true";

    let toolbar = host.querySelector(":scope > .table-fullscreen-toolbar");

    if (!toolbar) {
      toolbar = document.createElement("div");
      toolbar.className = "table-fullscreen-toolbar";
      host.insertBefore(toolbar, host.firstChild);
    }

    let button = toolbar.querySelector(":scope > .table-fullscreen-button");

    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "table-fullscreen-button";
      button.textContent = "전체화면";
      button.setAttribute("aria-label", "표 전체화면 보기");
      button.setAttribute("aria-haspopup", "dialog");
      toolbar.appendChild(button);
    }

    return button;
  }

  function initTable(table) {
    if (!table || table.dataset.tableFullscreenInitialized === "true" || shouldSkipTable(table)) {
      return;
    }

    const button = ensureHost(table);
    const overlay = ensureOverlay();

    button.addEventListener("click", function () {
      overlay.openOverlay(table, button);
    });

    table.dataset.tableFullscreenInitialized = "true";
  }

  function initTables(root) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;

    for (const table of scope.querySelectorAll(TABLE_SELECTOR)) {
      initTable(table);
    }
  }

  function init() {
    initTables(document);
  }

  if (typeof document$ !== "undefined" && document$) {
    document$.subscribe(function () {
      if (overlayElements) {
        overlayElements.closeOverlay();
      }

      initTables(document);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
