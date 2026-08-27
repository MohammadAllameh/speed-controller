/**
 * Video Speed Controller - Popup Script
 * Features automatic script injection for existing tabs,
 * instant speed synchronization, and real-time status.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // DOM Elements
  const speedValueEl = document.getElementById('speed-value');
  const speedSlider = document.getElementById('speed-slider');
  const directSpeedInput = document.getElementById('direct-speed-input');
  const btnResetHeader = document.getElementById('btn-reset-header');
  const btnFineDec = document.getElementById('btn-fine-dec');
  const btnFineInc = document.getElementById('btn-fine-inc');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const stepButtons = document.querySelectorAll('.step-btn');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');

  // Settings Elements
  const toggleRememberSpeed = document.getElementById('toggle-remember-speed');
  const toggleOSD = document.getElementById('toggle-osd');
  const toggleShortcuts = document.getElementById('toggle-shortcuts');

  let currentSpeed = 1.0;
  const MIN_SPEED = 0.1;
  const MAX_SPEED = 16.0;

  /**
   * Clamp speed helper
   */
  function clamp(val) {
    const num = parseFloat(val);
    if (isNaN(num)) return 1.0;
    return Math.max(MIN_SPEED, Math.min(MAX_SPEED, Math.round(num * 100) / 100));
  }

  /**
   * Update visual slider background track fill
   */
  function updateSliderFill(val) {
    const pct = ((val - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 100;
    speedSlider.style.background = `linear-gradient(to right, #6366f1 0%, #06b6d4 ${pct}%, #334155 ${pct}%, #334155 100%)`;
  }

  /**
   * Update all UI elements with new speed value
   */
  function renderSpeed(val) {
    currentSpeed = clamp(val);

    // Number text
    speedValueEl.textContent = currentSpeed.toFixed(2);

    // Slider
    speedSlider.value = currentSpeed;
    updateSliderFill(currentSpeed);

    // Direct Input
    directSpeedInput.value = currentSpeed;

    // Highlight Preset buttons
    presetButtons.forEach((btn) => {
      const btnSpeed = parseFloat(btn.dataset.speed);
      if (Math.abs(btnSpeed - currentSpeed) < 0.01) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  /**
   * Check if a URL can receive content scripts
   */
  function isInjectableUrl(url) {
    if (!url) return false;
    return (
      url.startsWith('http://') ||
      url.startsWith('https://') ||
      url.startsWith('file://')
    );
  }

  /**
   * Dynamically inject content script & CSS if not already present
   */
  function ensureContentScript(tabId, callback) {
    if (!chrome.scripting) {
      if (callback) callback(false);
      return;
    }

    // Inject CSS
    chrome.scripting
      .insertCSS({
        target: { tabId: tabId, allFrames: true },
        files: ['scripts/content.css']
      })
      .catch(() => {});

    // Inject JS
    chrome.scripting
      .executeScript({
        target: { tabId: tabId, allFrames: true },
        files: ['scripts/content.js']
      })
      .then(() => {
        if (callback) callback(true);
      })
      .catch((err) => {
        console.warn('[VSC] Injection failed:', err);
        if (callback) callback(false);
      });
  }

  /**
   * Send speed command to active tab with auto-injection fallback
   */
  function sendSpeedToTab(val) {
    renderSpeed(val);

    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const activeTab = tabs[0];
        const tabId = activeTab.id;

        if (!isInjectableUrl(activeTab.url)) {
          statusDot.classList.remove('active');
          statusText.textContent = 'در صفحات سیستمی مرورگر غیرفعال است';
          return;
        }

        chrome.tabs.sendMessage(
          tabId,
          { type: 'SET_SPEED', speed: currentSpeed },
          (response) => {
            if (chrome.runtime.lastError) {
              // Attempt dynamic injection then retry
              ensureContentScript(tabId, (success) => {
                if (success) {
                  setTimeout(() => {
                    chrome.tabs.sendMessage(
                      tabId,
                      { type: 'SET_SPEED', speed: currentSpeed },
                      (retryRes) => {
                        if (!chrome.runtime.lastError && retryRes) {
                          updateStatus(retryRes.videoCount);
                        } else {
                          statusDot.classList.add('active');
                          statusText.textContent = 'سرعت با موفقیت تنظیم شد';
                        }
                      }
                    );
                  }, 60);
                } else {
                  statusDot.classList.remove('active');
                  statusText.textContent = 'صفحه را رفرش (F5) کنید';
                }
              });
            } else if (response) {
              updateStatus(response.videoCount);
            }
          }
        );
      });
    }

    // Save to storage
    if (toggleRememberSpeed && toggleRememberSpeed.checked && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ savedSpeed: currentSpeed }).catch(() => {});
    }
  }

  /**
   * Update status bar
   */
  function updateStatus(videoCount) {
    statusDot.classList.add('active');
    if (typeof videoCount === 'number' && videoCount > 0) {
      statusText.textContent = `${videoCount} ویدیو در حال کنترل است`;
    } else {
      statusText.textContent = 'متصل (آماده به محض پخش ویدیو)';
    }
  }

  /**
   * Save and sync updated settings
   */
  function saveSettings() {
    const newSettings = {
      rememberSpeed: toggleRememberSpeed.checked,
      showOSD: toggleOSD.checked,
      enableShortcuts: toggleShortcuts.checked
    };

    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.set(newSettings).catch(() => {});
    }

    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0) {
          chrome.tabs.sendMessage(
            tabs[0].id,
            { type: 'UPDATE_SETTINGS', settings: newSettings }
          ).catch(() => {});
        }
      });
    }
  }

  /**
   * Initialize popup and connect with active tab
   */
  function loadInitialState() {
    // 1. Load settings & stored speed
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(
        {
          rememberSpeed: true,
          savedSpeed: 1.0,
          showOSD: true,
          enableShortcuts: true
        },
        (items) => {
          if (items) {
            toggleRememberSpeed.checked = !!items.rememberSpeed;
            toggleOSD.checked = !!items.showOSD;
            toggleShortcuts.checked = !!items.enableShortcuts;

            if (items.rememberSpeed && typeof items.savedSpeed === 'number') {
              renderSpeed(items.savedSpeed);
            }
          }
        }
      );
    }

    // 2. Query active tab
    if (chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const activeTab = tabs[0];
        const tabId = activeTab.id;

        if (!isInjectableUrl(activeTab.url)) {
          statusDot.classList.remove('active');
          statusText.textContent = 'در صفحات سیستمی مرورگر غیرفعال است';
          return;
        }

        // Try getting speed from content script
        chrome.tabs.sendMessage(tabId, { type: 'GET_SPEED' }, (res) => {
          if (chrome.runtime.lastError) {
            // Auto inject and retry
            ensureContentScript(tabId, (success) => {
              if (success) {
                setTimeout(() => {
                  chrome.tabs.sendMessage(tabId, { type: 'GET_SPEED' }, (retryRes) => {
                    if (!chrome.runtime.lastError && retryRes) {
                      if (typeof retryRes.speed === 'number') {
                        renderSpeed(retryRes.speed);
                      }
                      updateStatus(retryRes.videoCount);
                    } else {
                      updateStatus(0);
                    }
                  });
                }, 60);
              } else {
                statusDot.classList.remove('active');
                statusText.textContent = 'برای فعال‌سازی صفحه را رفرش (F5) کنید';
              }
            });
          } else if (res) {
            if (typeof res.speed === 'number') {
              renderSpeed(res.speed);
            }
            updateStatus(res.videoCount);
            if (res.settings) {
              toggleRememberSpeed.checked = !!res.settings.rememberSpeed;
              toggleOSD.checked = !!res.settings.showOSD;
              toggleShortcuts.checked = !!res.settings.enableShortcuts;
            }
          }
        });
      });
    }
  }

  // --- Event Listeners ---

  speedSlider.addEventListener('input', (e) => {
    sendSpeedToTab(parseFloat(e.target.value));
  });

  directSpeedInput.addEventListener('change', (e) => {
    sendSpeedToTab(parseFloat(e.target.value));
  });
  directSpeedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendSpeedToTab(parseFloat(e.target.value));
      directSpeedInput.blur();
    }
  });

  btnFineDec.addEventListener('click', () => {
    sendSpeedToTab(currentSpeed - 0.1);
  });
  btnFineInc.addEventListener('click', () => {
    sendSpeedToTab(currentSpeed + 0.1);
  });

  btnResetHeader.addEventListener('click', () => {
    sendSpeedToTab(1.0);
  });

  stepButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const step = parseFloat(btn.dataset.step);
      if (!isNaN(step)) {
        sendSpeedToTab(currentSpeed + step);
      }
    });
  });

  presetButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const speed = parseFloat(btn.dataset.speed);
      if (!isNaN(speed)) {
        sendSpeedToTab(speed);
      }
    });
  });

  toggleRememberSpeed.addEventListener('change', saveSettings);
  toggleOSD.addEventListener('change', saveSettings);
  toggleShortcuts.addEventListener('change', saveSettings);

  // Initialize
  renderSpeed(1.0);
  loadInitialState();
});
