/**
 * Video Speed Controller - Content Script
 * Robust media controller with dynamic DOM tracking, capture-phase listeners,
 * and support for modern dynamic web apps (Instagram, YouTube, Aparat, etc.)
 */

(function () {
  'use strict';

  // Prevent multiple executions in the same frame
  if (window.__VIDEO_SPEED_CONTROLLER_ACTIVE__) {
    // Re-trigger speed application if already injected
    if (typeof window.__vsc_applyCurrentSpeed === 'function') {
      window.__vsc_applyCurrentSpeed();
    }
    return;
  }
  window.__VIDEO_SPEED_CONTROLLER_ACTIVE__ = true;

  const DEFAULT_SETTINGS = {
    rememberSpeed: true,
    savedSpeed: 1.0,
    showOSD: true,
    enableShortcuts: true,
    stepDelta: 0.1,
    largeStepDelta: 0.5
  };

  let currentSpeed = 1.0;
  let settings = { ...DEFAULT_SETTINGS };
  const activeMediaElements = new Set();
  let isApplyingRate = false;
  let osdElement = null;
  let osdTimer = null;

  /**
   * Clamp speed between 0.1 and 16.0
   */
  function clampSpeed(speed) {
    const num = parseFloat(speed);
    if (isNaN(num)) return 1.0;
    return Math.max(0.1, Math.min(16.0, Math.round(num * 100) / 100));
  }

  /**
   * Safe OSD Badge Creator & Displayer
   */
  function showOSDBadge(speed) {
    if (!settings.showOSD) return;

    try {
      if (!osdElement || !document.contains(osdElement)) {
        osdElement = document.createElement('div');
        osdElement.className = 'vsc-osd-badge';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'vsc-osd-icon';
        iconSpan.textContent = '⚡';

        const textSpan = document.createElement('span');
        textSpan.className = 'vsc-osd-text';

        osdElement.appendChild(iconSpan);
        osdElement.appendChild(textSpan);
        (document.body || document.documentElement).appendChild(osdElement);
      }

      const textSpan = osdElement.querySelector('.vsc-osd-text');
      if (textSpan) {
        textSpan.textContent = `${speed.toFixed(2)}x`;
      }

      osdElement.classList.add('vsc-osd-show');

      if (osdTimer) {
        clearTimeout(osdTimer);
      }

      osdTimer = setTimeout(() => {
        if (osdElement) {
          osdElement.classList.remove('vsc-osd-show');
        }
      }, 1200);
    } catch (e) {}
  }

  /**
   * Apply playback rate to a single media element
   */
  function applySpeedToMedia(media, speed) {
    if (!media || isApplyingRate) return;

    try {
      isApplyingRate = true;
      if (Math.abs(media.playbackRate - speed) > 0.001) {
        media.playbackRate = speed;
      }
      if (media.defaultPlaybackRate !== undefined && Math.abs(media.defaultPlaybackRate - speed) > 0.001) {
        media.defaultPlaybackRate = speed;
      }
      if (media.preservesPitch !== undefined) {
        media.preservesPitch = true;
      }
      if (media.mozPreservesPitch !== undefined) {
        media.mozPreservesPitch = true;
      }
      if (media.webkitPreservesPitch !== undefined) {
        media.webkitPreservesPitch = true;
      }
    } catch (e) {
      // Cross-origin / protected media element
    } finally {
      isApplyingRate = false;
    }
  }

  /**
   * Recursively collect all media elements including inside Shadow DOM
   */
  function collectAllMedia(root, results = new Set()) {
    if (!root) return results;

    try {
      if (root.tagName === 'VIDEO' || root.tagName === 'AUDIO') {
        results.add(root);
      }

      if (root.querySelectorAll) {
        const found = root.querySelectorAll('video, audio');
        for (let i = 0; i < found.length; i++) {
          results.add(found[i]);
        }
      }

      // Check shadow roots
      if (root.shadowRoot) {
        collectAllMedia(root.shadowRoot, results);
      }

      if (root.querySelectorAll) {
        const allElements = root.querySelectorAll('*');
        for (let i = 0; i < allElements.length; i++) {
          if (allElements[i].shadowRoot) {
            collectAllMedia(allElements[i].shadowRoot, results);
          }
        }
      }
    } catch (e) {}

    return results;
  }

  /**
   * Apply current speed to all detected media elements
   */
  function applySpeedToAll(speed, triggerOSD = false) {
    currentSpeed = clampSpeed(speed);

    // 1. Clean dead media from set
    const deadMedia = [];
    activeMediaElements.forEach((m) => {
      if (!document.contains(m)) {
        deadMedia.push(m);
      } else {
        applySpeedToMedia(m, currentSpeed);
      }
    });
    deadMedia.forEach((m) => activeMediaElements.delete(m));

    // 2. Discover all media elements on the page (regular DOM & Shadow DOM)
    const allFound = collectAllMedia(document.documentElement || document.body);
    allFound.forEach((media) => {
      registerMedia(media);
      applySpeedToMedia(media, currentSpeed);
    });

    if (triggerOSD) {
      showOSDBadge(currentSpeed);
    }

    // 3. Save speed if enabled
    if (settings.rememberSpeed && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ savedSpeed: currentSpeed }).catch(() => {});
    }
  }

  window.__vsc_applyCurrentSpeed = () => applySpeedToAll(currentSpeed, false);

  /**
   * Register and listen to events on a media element
   */
  function registerMedia(media) {
    if (!media || activeMediaElements.has(media)) return;

    activeMediaElements.add(media);
    applySpeedToMedia(media, currentSpeed);

    const onRateChange = () => {
      if (!isApplyingRate && Math.abs(media.playbackRate - currentSpeed) > 0.01) {
        // Enforce target speed if player tries to reset it
        applySpeedToMedia(media, currentSpeed);
      }
    };

    const onMediaPlay = () => {
      applySpeedToMedia(media, currentSpeed);
    };

    media.addEventListener('ratechange', onRateChange);
    media.addEventListener('play', onMediaPlay);
    media.addEventListener('playing', onMediaPlay);
    media.addEventListener('loadedmetadata', onMediaPlay);
    media.addEventListener('canplay', onMediaPlay);
    media.addEventListener('timeupdate', onMediaPlay);
  }

  /**
   * Global Capture Event Listeners:
   * Catches media events on ANY element as soon as it is created or manipulated by frameworks (React/Instagram/YouTube)
   */
  function setupGlobalCaptureListeners() {
    const events = ['play', 'playing', 'ratechange', 'loadeddata', 'canplay'];
    events.forEach((evtName) => {
      window.addEventListener(
        evtName,
        (event) => {
          const target = event.target;
          if (target && (target.tagName === 'VIDEO' || target.tagName === 'AUDIO')) {
            registerMedia(target);
            applySpeedToMedia(target, currentSpeed);
          }
        },
        true // Capture phase!
      );
    });
  }

  /**
   * Periodic Scanner for Dynamic SPA navigation (Instagram Reels / Feed, TikTok, YouTube Shorts)
   */
  function setupPeriodicScanner() {
    setInterval(() => {
      const allFound = collectAllMedia(document.documentElement || document.body);
      allFound.forEach((media) => {
        registerMedia(media);
        if (Math.abs(media.playbackRate - currentSpeed) > 0.01) {
          applySpeedToMedia(media, currentSpeed);
        }
      });
    }, 400);
  }

  /**
   * Setup MutationObserver
   */
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const mutation = mutations[i];
        if (mutation.type === 'childList') {
          for (let j = 0; j < mutation.addedNodes.length; j++) {
            const node = mutation.addedNodes[j];
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                registerMedia(node);
                applySpeedToMedia(node, currentSpeed);
              } else {
                const innerMedia = collectAllMedia(node);
                innerMedia.forEach((m) => {
                  registerMedia(m);
                  applySpeedToMedia(m, currentSpeed);
                });
              }
            }
          }
        }
      }
    });

    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  /**
   * Check if element is an editable input
   */
  function isEditableElement(el) {
    if (!el) return false;
    const tagName = el.tagName ? el.tagName.toLowerCase() : '';
    if (['input', 'textarea', 'select'].includes(tagName)) return true;
    if (el.isContentEditable) return true;
    if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
    return false;
  }

  /**
   * Setup Keyboard Shortcuts
   */
  function setupKeyboardShortcuts() {
    window.addEventListener(
      'keydown',
      (event) => {
        if (!settings.enableShortcuts) return;

        const activeEl = document.activeElement;
        if (isEditableElement(activeEl) || isEditableElement(event.target)) {
          return;
        }

        if (event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }

        const key = event.key;
        const delta = event.shiftKey ? settings.largeStepDelta : settings.stepDelta;

        if (key === ']' || key === '}') {
          event.preventDefault();
          event.stopPropagation();
          applySpeedToAll(currentSpeed + delta, true);
        } else if (key === '[' || key === '{') {
          event.preventDefault();
          event.stopPropagation();
          applySpeedToAll(currentSpeed - delta, true);
        } else if (key === '\\' || key === 'r' || key === 'R') {
          event.preventDefault();
          event.stopPropagation();
          applySpeedToAll(1.0, true);
        } else if (key === 'z' || key === 'Z') {
          activeMediaElements.forEach((v) => {
            try {
              v.currentTime = Math.max(0, v.currentTime - 5);
            } catch (e) {}
          });
        } else if (key === 'x' || key === 'X') {
          activeMediaElements.forEach((v) => {
            try {
              v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 5);
            } catch (e) {}
          });
        }
      },
      true
    );
  }

  /**
   * Setup Runtime Message Listener
   */
  function setupMessageListener() {
    if (!chrome.runtime || !chrome.runtime.onMessage) return;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type) return;

      switch (message.type) {
        case 'GET_SPEED': {
          const allFound = collectAllMedia(document.documentElement || document.body);
          allFound.forEach((m) => registerMedia(m));
          sendResponse({
            speed: currentSpeed,
            videoCount: activeMediaElements.size,
            settings: settings
          });
          break;
        }

        case 'SET_SPEED': {
          const newSpeed = parseFloat(message.speed);
          if (!isNaN(newSpeed)) {
            applySpeedToAll(newSpeed, true);
            sendResponse({ success: true, speed: currentSpeed, videoCount: activeMediaElements.size });
          }
          break;
        }

        case 'STEP_SPEED': {
          const delta = parseFloat(message.delta) || 0.1;
          applySpeedToAll(currentSpeed + delta, true);
          sendResponse({ success: true, speed: currentSpeed, videoCount: activeMediaElements.size });
          break;
        }

        case 'RESET_SPEED': {
          applySpeedToAll(1.0, true);
          sendResponse({ success: true, speed: 1.0, videoCount: activeMediaElements.size });
          break;
        }

        case 'UPDATE_SETTINGS': {
          if (message.settings) {
            settings = { ...settings, ...message.settings };
          }
          sendResponse({ success: true, settings: settings });
          break;
        }
      }
      return true;
    });
  }

  /**
   * Initialize content script
   */
  function initialize() {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
        if (!chrome.runtime.lastError && items) {
          settings = { ...DEFAULT_SETTINGS, ...items };
          if (settings.rememberSpeed && typeof settings.savedSpeed === 'number') {
            currentSpeed = clampSpeed(settings.savedSpeed);
          }
        }
        applySpeedToAll(currentSpeed, false);
      });
    } else {
      applySpeedToAll(currentSpeed, false);
    }

    setupGlobalCaptureListeners();
    setupObserver();
    setupPeriodicScanner();
    setupKeyboardShortcuts();
    setupMessageListener();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        applySpeedToAll(currentSpeed, false);
      });
    } else {
      applySpeedToAll(currentSpeed, false);
    }
  }

  initialize();
})();
