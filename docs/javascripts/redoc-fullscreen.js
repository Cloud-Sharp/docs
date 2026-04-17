(function () {
  if (window.__mkdocsRedocFullscreenInit) {
    return;
  }

  window.__mkdocsRedocFullscreenInit = true;

  const HOST_SELECTOR = "[data-redoc-fullscreen]";
  const SHELL_SELECTOR = "[data-redoc-fullscreen-shell]";
  const TRIGGER_SELECTOR = "[data-redoc-fullscreen-trigger]";

  let overlayElements = null;

  function ensureOverlay() {
    if (overlayElements) {
      return overlayElements;
    }

    const overlay = document.createElement("div");
    overlay.className = "redoc-fullscreen-overlay";
    overlay.hidden = true;

    const backdrop = document.createElement("div");
    backdrop.className = "redoc-fullscreen-overlay__backdrop";
    overlay.appendChild(backdrop);

    const dialog = document.createElement("div");
    dialog.className = "redoc-fullscreen-overlay__dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", "API 문서 전체화면 보기");
    overlay.appendChild(dialog);

    const toolbar = document.createElement("div");
    toolbar.className = "redoc-fullscreen-overlay__toolbar";
    dialog.appendChild(toolbar);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "redoc-fullscreen-overlay__close";
    closeButton.textContent = "닫기";
    closeButton.setAttribute("aria-label", "API 문서 전체화면 닫기");
    toolbar.appendChild(closeButton);

    const viewport = document.createElement("div");
    viewport.className = "redoc-fullscreen-overlay__viewport";
    viewport.tabIndex = -1;
    dialog.appendChild(viewport);

    const anchor = document.createElement("div");
    anchor.className = "redoc-fullscreen-overlay__anchor";
    viewport.appendChild(anchor);

    function closeOverlay() {
      if (overlay.hidden) {
        return;
      }

      const active = overlayElements.activeSession;
      if (active && active.placeholder && active.shell && active.placeholder.parentNode) {
        active.placeholder.parentNode.replaceChild(active.shell, active.placeholder);
      }

      overlay.hidden = true;
      anchor.replaceChildren();
      document.body.classList.remove("redoc-fullscreen-open");

      if (overlayElements.previousBodyOverflow !== undefined) {
        document.body.style.overflow = overlayElements.previousBodyOverflow;
      } else {
        document.body.style.removeProperty("overflow");
      }

      if (active && active.trigger && typeof active.trigger.focus === "function") {
        active.trigger.focus();
      }

      overlayElements.activeSession = null;
    }

    function openOverlay(shell, trigger) {
      if (!shell || overlayElements.activeSession) {
        return;
      }

      const placeholder = document.createElement("div");
      placeholder.className = "redoc-fullscreen-placeholder";
      shell.parentNode.insertBefore(placeholder, shell);
      anchor.appendChild(shell);

      overlayElements.previousBodyOverflow = document.body.style.overflow;
      document.body.classList.add("redoc-fullscreen-open");
      document.body.style.overflow = "hidden";
      overlay.hidden = false;
      overlayElements.activeSession = {
        shell: shell,
        placeholder: placeholder,
        trigger: trigger || null,
      };

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
      anchor: anchor,
      closeOverlay: closeOverlay,
      openOverlay: openOverlay,
      activeSession: null,
      previousBodyOverflow: undefined,
    };

    return overlayElements;
  }

  function initHost(host) {
    if (!host || host.dataset.redocFullscreenInitialized === "true") {
      return;
    }

    const shell = host.querySelector(SHELL_SELECTOR);
    const trigger = host.querySelector(TRIGGER_SELECTOR);
    if (!shell || !trigger) {
      return;
    }

    const overlay = ensureOverlay();
    trigger.addEventListener("click", function () {
      overlay.openOverlay(shell, trigger);
    });

    host.dataset.redocFullscreenInitialized = "true";
  }

  function initHosts(root) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    for (const host of scope.querySelectorAll(HOST_SELECTOR)) {
      initHost(host);
    }
  }

  function init() {
    initHosts(document);
  }

  if (typeof document$ !== "undefined" && document$) {
    document$.subscribe(function () {
      if (overlayElements) {
        overlayElements.closeOverlay();
      }
      initHosts(document);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
