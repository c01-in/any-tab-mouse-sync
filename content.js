(function () {
  if (window.__anyTabMouseSyncInitialized) {
    return;
  }
  window.__anyTabMouseSyncInitialized = true;

  let syncEnabled = false;
  let applyingRemoteScroll = false;
  let pendingMove = null;
  let moveRafId = null;
  let pendingScrollRatio = null;
  let scrollRafId = null;
  let pendingWheel = null;
  let wheelRafId = null;
  let hideCursorTimer = null;
  let runtimeAlive = true;
  let remoteDragActive = false;
  let remoteDragButton = 0;
  let remoteDragPointerType = "mouse";
  let remoteDragTarget = null;
  let remoteHoverTarget = null;
  let remoteFocusedMenuItem = null;
  let applyingRemoteMenuFocus = false;
  let localWheelActiveUntil = 0;
  let lastMenuBroadcastKey = "";

  document
    .querySelectorAll("#__mouse_sync_remote_cursor__, .__mouse_sync_ripple_layer__")
    .forEach((node) => node.remove());

  const cursorEl = document.createElement("div");
  cursorEl.id = "__mouse_sync_remote_cursor__";
  cursorEl.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "width:16px",
    "height:16px",
    "border-radius:50%",
    "background:#ff4d4f",
    "border:2px solid #fff",
    "box-shadow:0 0 0 3px rgba(255,77,79,0.35)",
    "pointer-events:none",
    "z-index:2147483647",
    "transform:translate(-50%,-50%)",
    "display:none"
  ].join(";");

  const cursorLabelEl = document.createElement("div");
  cursorLabelEl.style.cssText = [
    "position:absolute",
    "left:18px",
    "top:-2px",
    "font:12px/1.3 monospace",
    "background:rgba(0,0,0,0.75)",
    "color:#fff",
    "padding:2px 6px",
    "border-radius:999px",
    "white-space:nowrap"
  ].join(";");
  cursorEl.appendChild(cursorLabelEl);
  document.documentElement.appendChild(cursorEl);

  const rippleLayer = document.createElement("div");
  rippleLayer.className = "__mouse_sync_ripple_layer__";
  rippleLayer.style.cssText = [
    "position:fixed",
    "inset:0",
    "pointer-events:none",
    "z-index:2147483646"
  ].join(";");
  document.documentElement.appendChild(rippleLayer);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function showRemoteCursor(nx, ny, label) {
    const x = clamp(nx, 0, 1) * window.innerWidth;
    const y = clamp(ny, 0, 1) * window.innerHeight;
    cursorEl.style.left = `${x}px`;
    cursorEl.style.top = `${y}px`;
    cursorLabelEl.textContent = label;
    cursorEl.style.display = "block";
    if (hideCursorTimer) {
      clearTimeout(hideCursorTimer);
    }
    hideCursorTimer = setTimeout(() => {
      cursorEl.style.display = "none";
    }, 1500);
  }

  function showRipple(nx, ny) {
    const ripple = document.createElement("div");
    ripple.style.cssText = [
      "position:absolute",
      "left:0",
      "top:0",
      "width:16px",
      "height:16px",
      "border-radius:50%",
      "border:2px solid #ff4d4f",
      "transform-origin:center",
      "opacity:0.95"
    ].join(";");

    const x = clamp(nx, 0, 1) * window.innerWidth;
    const y = clamp(ny, 0, 1) * window.innerHeight;
    ripple.style.transform = `translate(${x - 8}px, ${y - 8}px) scale(0.2)`;
    rippleLayer.appendChild(ripple);

    const start = performance.now();
    const duration = 420;
    function tick(now) {
      const progress = clamp((now - start) / duration, 0, 1);
      const scale = 0.2 + progress * 5.8;
      const opacity = 0.95 - progress * 0.95;
      ripple.style.opacity = String(opacity);
      ripple.style.transform = `translate(${x - 8}px, ${y - 8}px) scale(${scale})`;
      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        ripple.remove();
      }
    }
    requestAnimationFrame(tick);
  }

  function toViewportPoint(nx, ny) {
    return {
      x: clamp(nx, 0, 1) * window.innerWidth,
      y: clamp(ny, 0, 1) * window.innerHeight,
    };
  }

  function buttonToButtonsMask(button) {
    if (button === 0) {
      return 1;
    }
    if (button === 1) {
      return 4;
    }
    if (button === 2) {
      return 2;
    }
    return 0;
  }

  function getActiveButtonsMask() {
    return remoteDragActive ? buttonToButtonsMask(remoteDragButton) : 0;
  }

  function buildMouseInit(payload, point, overrides = {}) {
    const button = Number.isInteger(payload.button) ? payload.button : 0;
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: point.x,
      clientY: point.y,
      screenX: window.screenX + point.x,
      screenY: window.screenY + point.y,
      button,
      buttons: getActiveButtonsMask(),
      detail: 1,
      ctrlKey: Boolean(payload.ctrlKey),
      shiftKey: Boolean(payload.shiftKey),
      altKey: Boolean(payload.altKey),
      metaKey: Boolean(payload.metaKey),
      ...overrides,
    };
  }

  function dispatchPointer(target, type, init, payload) {
    if (!window.PointerEvent) {
      return;
    }
    try {
      target.dispatchEvent(
        new PointerEvent(type, {
          ...init,
          pointerId: 1,
          pointerType: payload.pointerType || "mouse",
          isPrimary: true,
          pressure:
            type === "pointerdown" || (type === "pointermove" && remoteDragActive)
              ? 0.5
              : 0,
        })
      );
    } catch (_error) {
      // Ignore unsupported PointerEvent constructor issues.
    }
  }

  function dispatchMouse(target, type, init) {
    target.dispatchEvent(new MouseEvent(type, init));
  }

  function getMenuItemElement(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    const item = target.closest(
      '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]'
    );
    return isSyncMenuItem(item) ? item : null;
  }

  function getAllMenuItems() {
    return Array.from(
      document.querySelectorAll(
        '[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]'
      )
    );
  }

  function isSyncMenuItem(item) {
    if (!(item instanceof Element)) {
      return false;
    }
    if (item.hasAttribute("data-radix-collection-item")) {
      return true;
    }
    return Boolean(
      item.closest('[aria-label*="Context Menu"],[aria-label*="context menu"]')
    );
  }

  function isElementVisible(el) {
    if (!(el instanceof Element)) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function hasVisibleMenuItems() {
    const items = getAllMenuItems();
    for (const item of items) {
      if (isSyncMenuItem(item) && isElementVisible(item)) {
        return true;
      }
    }
    return false;
  }

  function menuIdentityForItem(item) {
    if (!item || !isSyncMenuItem(item)) {
      return null;
    }
    const role = item.getAttribute("role") || "";
    const ariaLabel = item.getAttribute("aria-label") || "";
    const text = (item.textContent || "").replace(/\s+/g, " ").trim();
    const visibleItems = getAllMenuItems().filter(
      (el) => isSyncMenuItem(el) && isElementVisible(el)
    );
    const same = visibleItems.filter(
      (el) =>
        (el.getAttribute("role") || "") === role &&
        (el.getAttribute("aria-label") || "") === ariaLabel &&
        ((el.textContent || "").replace(/\s+/g, " ").trim() === text)
    );
    const index = Math.max(0, same.indexOf(item));
    return { role, ariaLabel, text, index };
  }

  function findMenuItemByIdentity(identity) {
    const visibleItems = getAllMenuItems().filter(
      (el) => isSyncMenuItem(el) && isElementVisible(el)
    );
    let same = visibleItems.filter((el) => (el.getAttribute("role") || "") === identity.role);
    if (identity.ariaLabel) {
      same = same.filter((el) => (el.getAttribute("aria-label") || "") === identity.ariaLabel);
    } else if (identity.text) {
      same = same.filter(
        (el) => ((el.textContent || "").replace(/\s+/g, " ").trim() === identity.text)
      );
    }
    if (same.length === 0) {
      return null;
    }
    const idx = Math.min(Math.max(identity.index || 0, 0), same.length - 1);
    return same[idx];
  }

  function makePayloadForElement(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2));
    const y = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2));
    return {
      nx: clamp(x / window.innerWidth, 0, 1),
      ny: clamp(y / window.innerHeight, 0, 1),
      pointerType: "mouse",
      button: 0,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
    };
  }

  function replayMenuHoverByIdentity(identity) {
    let item = null;
    if (typeof identity.nx === "number" && typeof identity.ny === "number") {
      const point = toViewportPoint(identity.nx, identity.ny);
      item = getMenuItemAtPoint(point.x, point.y);
    }
    if (!item) {
      item = findMenuItemByIdentity(identity);
    }
    if (!item) {
      setMenuItemFocus(null);
      return;
    }

    const payload = makePayloadForElement(item);
    const point = toViewportPoint(payload.nx, payload.ny);
    const moveInit = buildMouseInit(payload, point, {
      button: 0,
      buttons: 0,
      detail: 0,
    });

    if (remoteHoverTarget !== item) {
      hoverTransition(remoteHoverTarget, item, moveInit, payload);
      remoteHoverTarget = item;
    }
    setMenuItemFocus(item);
    dispatchPointer(item, "pointermove", moveInit, payload);
    dispatchMouse(item, "mousemove", moveInit);
  }

  function getMenuItemAtPoint(x, y) {
    const list =
      typeof document.elementsFromPoint === "function"
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint(x, y)];
    for (const el of list) {
      const item = getMenuItemElement(el);
      if (item) {
        return item;
      }
    }
    return null;
  }

  function setMenuItemFocus(menuItem) {
    if (menuItem) {
      if (remoteFocusedMenuItem !== menuItem) {
        applyingRemoteMenuFocus = true;
        try {
          menuItem.focus({ preventScroll: true });
        } catch (_error) {
          if (typeof menuItem.focus === "function") {
            menuItem.focus();
          }
        }
        applyingRemoteMenuFocus = false;
        remoteFocusedMenuItem = menuItem;
      }
      return;
    }

    if (remoteFocusedMenuItem) {
      applyingRemoteMenuFocus = true;
      if (
        document.activeElement === remoteFocusedMenuItem &&
        typeof remoteFocusedMenuItem.blur === "function"
      ) {
        remoteFocusedMenuItem.blur();
      }
      applyingRemoteMenuFocus = false;
      remoteFocusedMenuItem = null;
    }
  }

  function getElementPath(node) {
    const path = [];
    let cur = node;
    while (cur && cur instanceof Element) {
      path.push(cur);
      const root = cur.getRootNode && cur.getRootNode();
      if (root && root.host) {
        cur = root.host;
      } else {
        cur = cur.parentElement;
      }
    }
    return path;
  }

  function hoverTransition(previousTarget, nextTarget, moveInit, payload) {
    if (previousTarget === nextTarget) {
      return;
    }

    const prevPath = previousTarget ? getElementPath(previousTarget) : [];
    const nextPath = nextTarget ? getElementPath(nextTarget) : [];
    const nextSet = new Set(nextPath);

    let common = null;
    for (const node of prevPath) {
      if (nextSet.has(node)) {
        common = node;
        break;
      }
    }

    if (previousTarget) {
      dispatchPointer(previousTarget, "pointerout", moveInit, payload);
      dispatchMouse(previousTarget, "mouseout", {
        ...moveInit,
        relatedTarget: nextTarget,
      });
    }

    for (const node of prevPath) {
      if (node === common) {
        break;
      }
      dispatchPointer(node, "pointerleave", moveInit, payload);
      dispatchMouse(node, "mouseleave", {
        ...moveInit,
        relatedTarget: nextTarget,
      });
    }

    if (nextTarget) {
      dispatchPointer(nextTarget, "pointerover", moveInit, payload);
      dispatchMouse(nextTarget, "mouseover", {
        ...moveInit,
        relatedTarget: previousTarget,
      });
    }

    const entering = [];
    for (const node of nextPath) {
      if (node === common) {
        break;
      }
      entering.push(node);
    }
    for (let i = entering.length - 1; i >= 0; i -= 1) {
      const node = entering[i];
      dispatchPointer(node, "pointerenter", moveInit, payload);
      dispatchMouse(node, "mouseenter", {
        ...moveInit,
        relatedTarget: previousTarget,
      });
    }
  }

  function replayRemoteHoverMove(payload) {
    const point = toViewportPoint(payload.nx, payload.ny);
    const target = document.elementFromPoint(point.x, point.y);
    const moveInit = buildMouseInit(payload, point, {
      button: remoteDragButton,
      buttons: getActiveButtonsMask(),
      detail: 0,
    });

    if (!target) {
      hoverTransition(remoteHoverTarget, null, moveInit, payload);
      setMenuItemFocus(null);
      remoteHoverTarget = null;
      return;
    }

    if (remoteHoverTarget !== target) {
      hoverTransition(remoteHoverTarget, target, moveInit, payload);
      remoteHoverTarget = target;
    }
    const menuItem = getMenuItemAtPoint(point.x, point.y);
    setMenuItemFocus(menuItem);

    dispatchPointer(target, "pointermove", moveInit, payload);
    dispatchMouse(target, "mousemove", moveInit);

    if (remoteDragActive && remoteDragTarget && remoteDragTarget !== target) {
      dispatchPointer(remoteDragTarget, "pointermove", moveInit, payload);
      dispatchMouse(remoteDragTarget, "mousemove", moveInit);
    }
  }

  function clearRemoteHover(payload = { pointerType: "mouse", button: 0 }) {
    const moveInit = buildMouseInit(
      payload,
      { x: window.innerWidth / 2, y: window.innerHeight / 2 },
      { detail: 0, buttons: 0 }
    );
    hoverTransition(remoteHoverTarget, null, moveInit, payload);
    setMenuItemFocus(null);
    remoteHoverTarget = null;
  }

  function emitMenuHover(identity, nx, ny) {
    const key = `hover|${identity.role}|${identity.ariaLabel}|${identity.text}|${identity.index}`;
    if (key === lastMenuBroadcastKey) {
      return;
    }
    lastMenuBroadcastKey = key;
    sendEvent({
      kind: "menu-hover",
      nx,
      ny,
      role: identity.role,
      ariaLabel: identity.ariaLabel,
      text: identity.text,
      index: identity.index,
    });
  }

  function emitMenuClear(nx, ny, pointerType, button) {
    if (lastMenuBroadcastKey === "clear") {
      return;
    }
    lastMenuBroadcastKey = "clear";
    sendEvent({
      kind: "menu-clear",
      nx,
      ny,
      pointerType,
      button,
    });
  }

  function handleLocalMotionSync(event, pointerType) {
    const nx = event.clientX / window.innerWidth;
    const ny = event.clientY / window.innerHeight;
    const menuItem = getMenuItemElement(event.target);
    const menuOpen = Boolean(menuItem) || hasVisibleMenuItems();

    if (menuOpen) {
      if (menuItem) {
        const identity = menuIdentityForItem(menuItem);
        if (identity) {
          emitMenuHover(identity, nx, ny);
          return;
        }
      }
      const button =
        Number.isInteger(event.button) && event.button >= 0 ? event.button : 0;
      emitMenuClear(nx, ny, pointerType || "mouse", button);
      return;
    }

    lastMenuBroadcastKey = "";
    queueMove(nx, ny);
  }

  function replayRemotePointerDown(payload) {
    const point = toViewportPoint(payload.nx, payload.ny);
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) {
      return;
    }

    remoteDragActive = true;
    remoteDragButton = Number.isInteger(payload.button) ? payload.button : 0;
    remoteDragPointerType = payload.pointerType || "mouse";
    remoteDragTarget = target;
    remoteHoverTarget = target;

    if (typeof target.focus === "function") {
      try {
        target.focus({ preventScroll: true });
      } catch (_error) {
        // Ignore focus errors from non-focusable elements.
      }
    }

    const downInit = buildMouseInit(payload, point, {
      button: remoteDragButton,
      buttons: buttonToButtonsMask(remoteDragButton),
      detail: 1,
    });
    dispatchPointer(target, "pointerdown", downInit, payload);
    dispatchMouse(target, "mousedown", downInit);
  }

  function replayRemotePointerUp(payload) {
    const point = toViewportPoint(payload.nx, payload.ny);
    const target =
      document.elementFromPoint(point.x, point.y) ||
      remoteDragTarget ||
      document.documentElement;
    const upButton = Number.isInteger(payload.button) ? payload.button : remoteDragButton;
    const upInit = buildMouseInit(payload, point, {
      button: upButton,
      buttons: 0,
      detail: 1,
      pointerType: remoteDragPointerType,
    });
    dispatchPointer(target, "pointerup", upInit, payload);
    dispatchMouse(target, "mouseup", upInit);
    remoteDragActive = false;
    remoteDragButton = 0;
    remoteDragPointerType = "mouse";
    remoteDragTarget = null;
  }

  function replayRemoteClick(payload) {
    const point = toViewportPoint(payload.nx, payload.ny);
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) {
      return;
    }
    dispatchMouse(
      target,
      "click",
      buildMouseInit(payload, point, {
        button: Number.isInteger(payload.button) ? payload.button : 0,
        buttons: 0,
        detail: Number.isInteger(payload.detail) ? payload.detail : 1,
      })
    );
  }

  function replayRemoteDoubleClick(payload) {
    const point = toViewportPoint(payload.nx, payload.ny);
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) {
      return;
    }
    dispatchMouse(
      target,
      "dblclick",
      buildMouseInit(payload, point, {
        button: Number.isInteger(payload.button) ? payload.button : 0,
        buttons: 0,
        detail: 2,
      })
    );
  }

  function replayRemoteContextMenu(payload) {
    const point = toViewportPoint(payload.nx, payload.ny);
    const target = document.elementFromPoint(point.x, point.y);
    if (!target) {
      return;
    }
    dispatchMouse(
      target,
      "contextmenu",
      buildMouseInit(payload, point, {
        button: 2,
        buttons: 2,
        detail: 1,
      })
    );
    setMenuItemFocus(getMenuItemAtPoint(point.x, point.y));
    if (remoteDragActive && remoteDragButton === 2) {
      remoteDragActive = false;
      remoteDragButton = 0;
      remoteDragPointerType = "mouse";
      remoteDragTarget = null;
    }
  }

  function findScrollableAncestor(element, deltaX, deltaY) {
    const needY = Math.abs(deltaY) >= Math.abs(deltaX);
    const needX = Math.abs(deltaX) > Math.abs(deltaY);
    let node = element;

    while (node && node !== document.documentElement) {
      if (node instanceof Element) {
        const style = window.getComputedStyle(node);
        const yScrollable =
          /(auto|scroll|overlay)/.test(style.overflowY) &&
          node.scrollHeight > node.clientHeight;
        const xScrollable =
          /(auto|scroll|overlay)/.test(style.overflowX) &&
          node.scrollWidth > node.clientWidth;
        if ((needY && yScrollable) || (needX && xScrollable) || (yScrollable && xScrollable)) {
          return node;
        }
      }

      const root = node.getRootNode && node.getRootNode();
      if (root && root.host) {
        node = root.host;
      } else {
        node = node.parentElement;
      }
    }
    return null;
  }

  function replayRemoteWheel(payload) {
    const point = toViewportPoint(payload.nx, payload.ny);
    const target = document.elementFromPoint(point.x, point.y) || document.body;
    const scrollContainer = findScrollableAncestor(
      target,
      Number(payload.deltaX) || 0,
      Number(payload.deltaY) || 0
    );
    const wheelInit = {
      ...buildMouseInit(payload, point, {
        button: 0,
        buttons: 0,
        detail: 0,
      }),
      deltaX: Number(payload.deltaX) || 0,
      deltaY: Number(payload.deltaY) || 0,
      deltaZ: Number(payload.deltaZ) || 0,
      deltaMode: Number(payload.deltaMode) || 0,
    };

    const beforeWindowX = window.scrollX;
    const beforeWindowY = window.scrollY;
    const beforeContainerX = scrollContainer ? scrollContainer.scrollLeft : 0;
    const beforeContainerY = scrollContainer ? scrollContainer.scrollTop : 0;

    let prevented = false;
    if (window.WheelEvent) {
      const wheelEvent = new WheelEvent("wheel", wheelInit);
      prevented = !target.dispatchEvent(wheelEvent);
    }

    if (!prevented && !payload.ctrlKey) {
      const afterWindowChanged =
        window.scrollX !== beforeWindowX || window.scrollY !== beforeWindowY;
      const afterContainerChanged = scrollContainer
        ? scrollContainer.scrollLeft !== beforeContainerX ||
          scrollContainer.scrollTop !== beforeContainerY
        : false;

      if (!afterWindowChanged && !afterContainerChanged && scrollContainer) {
        scrollContainer.scrollLeft += wheelInit.deltaX;
        scrollContainer.scrollTop += wheelInit.deltaY;
      }

      const changedAfterContainerFallback = scrollContainer
        ? scrollContainer.scrollLeft !== beforeContainerX ||
          scrollContainer.scrollTop !== beforeContainerY
        : false;
      const changedAfterWindow = window.scrollX !== beforeWindowX || window.scrollY !== beforeWindowY;

      if (!changedAfterContainerFallback && !changedAfterWindow) {
        applyingRemoteScroll = true;
        window.scrollBy({
          left: wheelInit.deltaX,
          top: wheelInit.deltaY,
          behavior: "auto",
        });
        requestAnimationFrame(() => {
          applyingRemoteScroll = false;
        });
      }
    }
  }

  function getScrollRatio() {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) {
      return 0;
    }
    return window.scrollY / maxScroll;
  }

  function setScrollRatio(ratio) {
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    if (maxScroll <= 0) {
      return;
    }
    applyingRemoteScroll = true;
    window.scrollTo(0, clamp(ratio, 0, 1) * maxScroll);
    requestAnimationFrame(() => {
      applyingRemoteScroll = false;
    });
  }

  function markRuntimeDown() {
    runtimeAlive = false;
    syncEnabled = false;
    cursorEl.style.display = "none";
  }

  function sendEvent(event) {
    if (!runtimeAlive) {
      return;
    }
    try {
      chrome.runtime.sendMessage(
        {
          type: "relay-event",
          event,
        },
        () => {
          if (chrome.runtime.lastError) {
            markRuntimeDown();
          }
        }
      );
    } catch (_error) {
      markRuntimeDown();
    }
  }

  function queueMove(nx, ny) {
    pendingMove = { kind: "move", nx, ny };
    if (moveRafId != null) {
      return;
    }
    moveRafId = requestAnimationFrame(() => {
      moveRafId = null;
      if (!pendingMove || !syncEnabled) {
        return;
      }
      sendEvent(pendingMove);
      pendingMove = null;
    });
  }

  function queueScroll(ratio) {
    pendingScrollRatio = ratio;
    if (scrollRafId != null) {
      return;
    }
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      if (pendingScrollRatio == null || !syncEnabled) {
        return;
      }
      sendEvent({ kind: "scroll", ratio: pendingScrollRatio });
      pendingScrollRatio = null;
    });
  }

  function queueWheel(event) {
    if (!pendingWheel) {
      pendingWheel = {
        kind: "wheel",
        nx: event.clientX / window.innerWidth,
        ny: event.clientY / window.innerHeight,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaZ: event.deltaZ,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      };
    } else {
      pendingWheel.deltaX += event.deltaX;
      pendingWheel.deltaY += event.deltaY;
      pendingWheel.deltaZ += event.deltaZ;
      pendingWheel.nx = event.clientX / window.innerWidth;
      pendingWheel.ny = event.clientY / window.innerHeight;
      pendingWheel.ctrlKey = event.ctrlKey;
      pendingWheel.shiftKey = event.shiftKey;
      pendingWheel.altKey = event.altKey;
      pendingWheel.metaKey = event.metaKey;
    }

    if (wheelRafId != null) {
      return;
    }
    wheelRafId = requestAnimationFrame(() => {
      wheelRafId = null;
      if (!pendingWheel || !syncEnabled) {
        return;
      }
      sendEvent(pendingWheel);
      pendingWheel = null;
    });
  }

  window.addEventListener(
    "pointermove",
    (event) => {
      if (!syncEnabled) {
        return;
      }
      if (!event.isTrusted) {
        return;
      }
      handleLocalMotionSync(event, event.pointerType || "mouse");
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    "mousemove",
    (event) => {
      if (!syncEnabled) {
        return;
      }
      if (!event.isTrusted) {
        return;
      }
      if (window.PointerEvent) {
        return;
      }
      handleLocalMotionSync(event, "mouse");
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    "pointerdown",
    (event) => {
      if (!syncEnabled) {
        return;
      }
      if (!event.isTrusted) {
        return;
      }
      if (event.isPrimary === false) {
        return;
      }
      if (event.pointerType === "mouse" && ![0, 2].includes(event.button)) {
        return;
      }
      const nx = event.clientX / window.innerWidth;
      const ny = event.clientY / window.innerHeight;
      sendEvent({
        kind: "pointerdown",
        nx,
        ny,
        button: event.button,
        pointerType: event.pointerType || "mouse",
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    "pointerup",
    (event) => {
      if (!syncEnabled) {
        return;
      }
      if (!event.isTrusted) {
        return;
      }
      if (event.isPrimary === false) {
        return;
      }
      if (event.pointerType === "mouse" && ![0, 2].includes(event.button)) {
        return;
      }
      sendEvent({
        kind: "pointerup",
        nx: event.clientX / window.innerWidth,
        ny: event.clientY / window.innerHeight,
        button: event.button,
        pointerType: event.pointerType || "mouse",
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    "click",
    (event) => {
      if (!syncEnabled || !event.isTrusted) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      sendEvent({
        kind: "click",
        nx: event.clientX / window.innerWidth,
        ny: event.clientY / window.innerHeight,
        button: event.button,
        detail: event.detail,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    "dblclick",
    (event) => {
      if (!syncEnabled || !event.isTrusted) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      sendEvent({
        kind: "dblclick",
        nx: event.clientX / window.innerWidth,
        ny: event.clientY / window.innerHeight,
        button: event.button,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    "contextmenu",
    (event) => {
      if (!syncEnabled || !event.isTrusted) {
        return;
      }
      if (event.button !== 2) {
        return;
      }
      sendEvent({
        kind: "contextmenu",
        nx: event.clientX / window.innerWidth,
        ny: event.clientY / window.innerHeight,
        button: event.button,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
    },
    { capture: true }
  );

  window.addEventListener(
    "mouseout",
    (event) => {
      if (!syncEnabled || !event.isTrusted) {
        return;
      }
      if (event.relatedTarget != null) {
        return;
      }
      sendEvent({
        kind: "clear-hover",
        pointerType: "mouse",
        button: 0,
      });
    },
    { capture: true }
  );

  window.addEventListener(
    "pointerout",
    (event) => {
      if (!syncEnabled || !event.isTrusted) {
        return;
      }
      if (event.relatedTarget != null) {
        return;
      }
      sendEvent({
        kind: "clear-hover",
        pointerType: event.pointerType || "mouse",
        button: Number.isInteger(event.button) ? event.button : 0,
      });
    },
    { capture: true }
  );

  window.addEventListener(
    "focusin",
    (event) => {
      if (!syncEnabled || applyingRemoteMenuFocus) {
        return;
      }
      const item = getMenuItemElement(event.target);
      if (!item) {
        return;
      }
      const identity = menuIdentityForItem(item);
      if (!identity) {
        return;
      }
      sendEvent({
        kind: "menu-focus",
        role: identity.role,
        ariaLabel: identity.ariaLabel,
        text: identity.text,
        index: identity.index,
      });
    },
    { capture: true }
  );

  window.addEventListener(
    "focusout",
    (event) => {
      if (!syncEnabled || applyingRemoteMenuFocus) {
        return;
      }
      const fromItem = getMenuItemElement(event.target);
      if (!fromItem) {
        return;
      }
      const toItem = getMenuItemElement(event.relatedTarget);
      if (toItem) {
        return;
      }
      sendEvent({ kind: "menu-blur" });
    },
    { capture: true }
  );

  window.addEventListener(
    "wheel",
    (event) => {
      if (!syncEnabled) {
        return;
      }
      if (!event.isTrusted) {
        return;
      }
      localWheelActiveUntil = performance.now() + 140;
      queueWheel(event);
    },
    { passive: true, capture: true }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (!syncEnabled || applyingRemoteScroll) {
        return;
      }
      if (performance.now() < localWheelActiveUntil) {
        return;
      }
      queueScroll(getScrollRatio());
    },
    { passive: true }
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "ping") {
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "sync-state") {
      syncEnabled = Boolean(message.enabled);
      if (!syncEnabled) {
        clearRemoteHover({
          pointerType: remoteDragPointerType,
          button: remoteDragButton,
        });
        cursorEl.style.display = "none";
        remoteDragActive = false;
        remoteDragButton = 0;
        remoteDragPointerType = "mouse";
        remoteDragTarget = null;
        remoteHoverTarget = null;
        remoteFocusedMenuItem = null;
      }
      return;
    }

    if (message.type !== "remote-event" || !syncEnabled || !message.event) {
      return;
    }

    const label = `tab ${message.fromTabId}`;
    const event = message.event;
    if (event.kind === "move") {
      showRemoteCursor(event.nx, event.ny, label);
      replayRemoteHoverMove(event);
      return;
    }
    if (event.kind === "pointerdown") {
      showRemoteCursor(event.nx, event.ny, label);
      replayRemotePointerDown(event);
      return;
    }
    if (event.kind === "pointerup") {
      showRemoteCursor(event.nx, event.ny, label);
      replayRemotePointerUp(event);
      return;
    }
    if (event.kind === "click") {
      showRemoteCursor(event.nx, event.ny, label);
      showRipple(event.nx, event.ny);
      replayRemoteClick(event);
      return;
    }
    if (event.kind === "dblclick") {
      showRemoteCursor(event.nx, event.ny, label);
      showRipple(event.nx, event.ny);
      replayRemoteDoubleClick(event);
      return;
    }
    if (event.kind === "clear-hover") {
      clearRemoteHover(event);
      return;
    }
    if (event.kind === "menu-focus") {
      const item = findMenuItemByIdentity(event);
      if (item) {
        setMenuItemFocus(item);
      }
      return;
    }
    if (event.kind === "menu-hover") {
      if (typeof event.nx === "number" && typeof event.ny === "number") {
        showRemoteCursor(event.nx, event.ny, label);
      }
      replayMenuHoverByIdentity(event);
      return;
    }
    if (event.kind === "menu-clear") {
      if (typeof event.nx === "number" && typeof event.ny === "number") {
        showRemoteCursor(event.nx, event.ny, label);
      }
      clearRemoteHover(event);
      return;
    }
    if (event.kind === "menu-blur") {
      setMenuItemFocus(null);
      return;
    }
    if (event.kind === "contextmenu") {
      showRemoteCursor(event.nx, event.ny, label);
      showRipple(event.nx, event.ny);
      replayRemoteContextMenu(event);
      return;
    }
    if (event.kind === "wheel") {
      replayRemoteWheel(event);
      return;
    }
    if (event.kind === "scroll") {
      setScrollRatio(event.ratio);
    }
  });

  try {
    chrome.runtime.sendMessage({ type: "get-self-state" }, (response) => {
      if (chrome.runtime.lastError || !response) {
        markRuntimeDown();
        return;
      }
      runtimeAlive = true;
      syncEnabled = Boolean(response.enabled && response.supported);
    });
  } catch (_error) {
    markRuntimeDown();
  }
})();
