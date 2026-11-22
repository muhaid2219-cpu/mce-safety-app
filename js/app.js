/**
 * js/app.js
 * منطق واجهة المهندسين: PWA الذكي، التخزين المحلي أوفلاين، زر التثبيت والتحديث، والملء التلقائي
 * شركة المحايد مهندسون استشاريون (MCE)
 */

(function () {
  'use strict';

  const SETTINGS_LS_FALLBACK_KEY = 'MCE_PUBLIC_SETTINGS_CACHE_V1';

  let swRegistration = null;

  window.APP_STATE = {
    settings: null,
    isLoadingSettings: false,
    deferredInstallPrompt: null
  };

  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    registerServiceWorker();
    bindPwaInstallPrompt();
    bindConnectionMonitor();
    bindTabs();
    bindAutoExpandTextareas();
    bindDynamicFieldListeners();
    bindViolationPicker();
    bindFormActions();
    bindQueueActions();
    setDefaultDateTime();

    loadInitialSettings();
    refreshQueueUI();
  }

  /* ==================== إدارة PWA الذكية: التثبيت، الفحص، والتحديث ==================== */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(function (reg) {
          swRegistration = reg;

          // اكتشاف وجود نسخة جديدة قيد الانتظار في الخلفية
          reg.addEventListener('updatefound', function () {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', function () {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                notifyUserOfNewVersion(newWorker);
              }
            });
          });
        })
        .catch(function (err) {
          console.warn('SW registration note:', err);
        });

      // إعادة تحميل الصفحة فور تنشيط النسخة الجديدة تلقائياً
      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }

  function bindPwaInstallPrompt() {
    const pwaBtn = document.getElementById('installPwaBtn');
    if (!pwaBtn) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (isStandalone) {
      pwaBtn.textContent = '🔄 فحص تحديثات التطبيق';
    }

    // التقاط إذن التثبيت من المتصفح في حال توفره
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      window.APP_STATE.deferredInstallPrompt = e;
      if (!isStandalone) {
        pwaBtn.textContent = '📲 تثبيت التطبيق على الجهاز';
      }
    });

    window.addEventListener('appinstalled', function () {
      window.APP_STATE.deferredInstallPrompt = null;
      pwaBtn.textContent = '🔄 فحص تحديثات التطبيق';
      showGlobalAlert('success', 'تم تثبيت التطبيق بنجاح! يعمل الآن كتطبيق مستقل.');
    });

    pwaBtn.addEventListener('click', function () {
      // 1. إذا كان التثبيت متاحاً في المتصفح
      if (window.APP_STATE.deferredInstallPrompt) {
        const promptEvt = window.APP_STATE.deferredInstallPrompt;
        promptEvt.prompt();
        promptEvt.userChoice.then(function (choice) {
          if (choice.outcome === 'accepted') {
            window.APP_STATE.deferredInstallPrompt = null;
          }
        });
        return;
      }

      // 2. إذا كان على هاتف iPhone (Safari) وغير مثبت
      const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (isIos && !isStandalone) {
        showGlobalAlert('info', 'لتثبيت التطبيق على iPhone: اضغط على زر المشاركة (مربع بسهم لأعلى ⎋) في متصفح Safari ثم اختر "إضافة إلى الشاشة الرئيسية (Add to Home Screen)".');
        return;
      }

      // 3. إذا كان التطبيق مثبتاً أو يعمل في المتصفح -> فحص وجود نسخة جديدة من الخادم
      if (!navigator.onLine) {
        showGlobalAlert('warning', 'أنت غير متصل بالإنترنت حالياً؛ التطبيق يعمل بنسخته المخزنة أوفلاين.');
        return;
      }

      showGlobalAlert('info', 'جارٍ فحص التحديثات من الخادم...');
      pwaBtn.disabled = true;

      if (swRegistration) {
        swRegistration.update()
          .then(function () {
            setTimeout(function () {
              pwaBtn.disabled = false;
              if (swRegistration.waiting) {
                notifyUserOfNewVersion(swRegistration.waiting);
              } else {
                showGlobalAlert('success', 'تطبيقك يعمل بأحدث إصدار رسمي (الإصدار v6). لا توجد تحديثات جديدة.');
              }
            }, 1000);
          })
          .catch(function () {
            pwaBtn.disabled = false;
            showGlobalAlert('success', 'تطبيقك يعمل بأحدث إصدار رسمي.');
          });
      } else {
        setTimeout(function () {
          pwaBtn.disabled = false;
          showGlobalAlert('success', 'تطبيقك يعمل بأحدث إصدار رسمي.');
        }, 800);
      }
    });
  }

  function notifyUserOfNewVersion(worker) {
    const pwaBtn = document.getElementById('installPwaBtn');
    if (pwaBtn) {
      pwaBtn.textContent = '⚡ اضغط للتحديث الآن (نسخة جديدة)';
      pwaBtn.style.background = '#10b981';
      pwaBtn.style.borderColor = '#10b981';
      pwaBtn.onclick = function () {
        worker.postMessage({ action: 'skipWaiting' });
      };
    }
    showGlobalAlert('success', 'تتوفر نسخة جديدة ومحدثة من التطبيق! اضغط على زر "اضغط للتحديث الآن" بالأعلى لتنشيطها فوراً.');
  }

  /* ==================== مراقبة حالة الاتصال ==================== */
  function bindConnectionMonitor() {
    updateConnectionBadge();
    window.addEventListener('online', function () {
      updateConnectionBadge();
      fetchAndApplySettings(false);
    });
    window.addEventListener('offline', updateConnectionBadge);
  }

  function updateConnectionBadge() {
    const badge = document.getElementById('connectionStatusBadge');
    if (!badge) return;
    if (navigator.onLine) {
      badge.className = 'status-pill is-online';
      badge.textContent = 'متصل بالإنترنت';
    } else {
      badge.className = 'status-pill is-offline';
      badge.textContent = 'غير متصل بالإنترنت (وضع أوفلاين)';
    }
  }

  /* ==================== التبويبات ==================== */
  function bindTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const targetId = btn.getAttribute('data-target');
        switchToTab(targetId);
      });
    });
  }

  function switchToTab(targetId) {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-target') === targetId);
    });
    document.getElementById('newViolationPanel').classList.toggle('hidden-panel', targetId !== 'newViolationPanel');
    document.getElementById('localQueuePanel').classList.toggle('hidden-panel', targetId !== 'localQueuePanel');
    if (targetId === 'localQueuePanel') {
      refreshQueueUI();
    }
  }

  /* ==================== توسيع مربعات النص تلقائياً ==================== */
  function bindAutoExpandTextareas() {
    const areas = document.querySelectorAll('textarea.auto-expand');
    areas.forEach(function (el) {
      el.addEventListener('input', function () {
        autoResizeTextarea(el);
      });
    });
  }

  function autoResizeTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(82, el.scrollHeight) + 'px';
  }

  /* ==================== تحميل وتخزين الإعدادات (IndexedDB + الخادم) ==================== */
  function loadInitialSettings() {
    if (window.LocalDB && typeof window.LocalDB.getSettingsCache === 'function') {
      window.LocalDB.getSettingsCache()
        .then(function (cachedDb) {
          if (cachedDb) {
            applySettingsToUI(cachedDb);
          } else {
            const lsCached = readLsFallbackSettings();
            if (lsCached) applySettingsToUI(lsCached);
          }
        })
        .catch(function () {
          const lsCached = readLsFallbackSettings();
          if (lsCached) applySettingsToUI(lsCached);
        })
        .finally(function () {
          fetchAndApplySettings(false);
        });
    } else {
      const lsCached = readLsFallbackSettings();
      if (lsCached) applySettingsToUI(lsCached);
      fetchAndApplySettings(false);
    }
  }

  function fetchAndApplySettings(isManualRefresh) {
    if (window.APP_STATE.isLoadingSettings) return;
    if (!navigator.onLine) {
      if (isManualRefresh) {
        showGlobalAlert('warning', 'أنت غير متصل بالإنترنت حالياً؛ يتم العمل بآخر نسخة محفوظة من الإعدادات.');
      }
      return;
    }

    const apiUrl = window.APP_CONFIG && window.APP_CONFIG.API_URL;
    if (!apiUrl || apiUrl.indexOf('http') !== 0) {
      showGlobalAlert('error', 'رابط الخادم API_URL غير مضبوط في ملف config.js.');
      return;
    }

    window.APP_STATE.isLoadingSettings = true;
    const refreshBtn = document.getElementById('refreshSettingsBtn');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'جارٍ التحديث...';
    }

    const url = apiUrl + '?action=getPublicSettings&_ts=' + Date.now();
    fetch(url, { method: 'GET', cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (json) {
        if (!json || !json.success || !json.data) {
          throw new Error((json && json.error) || 'استجابة غير صالحة من الخادم');
        }
        persistSettingsLocally(json.data);
        applySettingsToUI(json.data);
        if (isManualRefresh) {
          showGlobalAlert('success', 'تم تحديث وحفظ قوائم المقاولين والمهندسين والمخالفات والشعارات بنجاح.');
        }
      })
      .catch(function (err) {
        console.error('Settings fetch error:', err);
        if (!window.APP_STATE.settings) {
          showGlobalAlert('error', 'تعذر تحميل الإعدادات من الخادم: ' + err.message);
        } else if (isManualRefresh) {
          showGlobalAlert('warning', 'تعذر الاتصال بالخادم حالياً؛ تم الإبقاء على الإعدادات المحفوظة محلياً.');
        }
      })
      .finally(function () {
        window.APP_STATE.isLoadingSettings = false;
        if (refreshBtn) {
          refreshBtn.disabled = false;
          refreshBtn.textContent = 'تحديث الإعدادات من الخادم';
        }
      });
  }

  function persistSettingsLocally(data) {
    if (window.LocalDB && typeof window.LocalDB.saveSettingsCache === 'function') {
      window.LocalDB.saveSettingsCache(data).catch(function () {});
    }
    try {
      localStorage.setItem(SETTINGS_LS_FALLBACK_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function readLsFallbackSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_LS_FALLBACK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function applySettingsToUI(settings) {
    window.APP_STATE.settings = settings;

    setText('headerCompanyName', settings.companyName || window.APP_CONFIG.DEFAULTS.COMPANY_NAME);
    setText('headerConsultingName', settings.consultingCompanyName || window.APP_CONFIG.DEFAULTS.CONSULTING_COMPANY_NAME);
    setText('headerFormTitle', settings.formTitle || window.APP_CONFIG.DEFAULTS.FORM_TITLE);

    const deptInput = document.getElementById('department');
    if (deptInput) {
      deptInput.value = settings.fixedDepartment || window.APP_CONFIG.DEFAULTS.FIXED_DEPARTMENT;
    }

    applyLogo('companyLogoImg', 'companyLogoPlaceholder', settings.companyLogoDataUri);
    applyLogo('consultingLogoImg', 'consultingLogoPlaceholder', settings.consultingLogoDataUri);

    populateSelect(
      'district',
      settings.departments || [],
      '-- اختر الدائرة --',
      function (d) { return d.districtName; },
      function (d) { return d.districtName; }
    );

    const sectionsList = (settings.sections && settings.sections.length > 0)
      ? settings.sections
      : ['الإنشاءات', 'العمليات والصيانة'];
    populateSelect(
      'section',
      sectionsList,
      '-- اختر القسم --',
      function (s) { return s; },
      function (s) { return s; }
    );

    populateSelect(
      'contractorId',
      settings.contractors || [],
      '-- اختر اسم المقاول --',
      function (c) { return c.id; },
      function (c) { return c.name; }
    );

    populateSelect(
      'consultantId',
      settings.engineers || [],
      '-- اختر اسم المهندس الاستشاري --',
      function (e) { return e.id; },
      function (e) { return e.name; }
    );

    renderViolationPickerList('');

    const minP = settings.minPhotos || 1;
    const maxP = settings.maxPhotos || 5;
    const hintEl = document.getElementById('photosLimitHint');
    if (hintEl) {
      hintEl.textContent = 'مطلوب إرفاق من ' + minP + ' إلى ' + maxP + ' صور واضحة للمخالفة (يتم ضغط الصور تلقائياً قبل الرفع).';
    }
    const countBadge = document.getElementById('photosCountBadge');
    if (countBadge && countBadge.textContent.indexOf('0 /') === 0) {
      countBadge.textContent = '0 / ' + maxP + ' صور';
    }
  }

  function applyLogo(imgId, placeholderId, dataUri) {
    const img = document.getElementById(imgId);
    const placeholder = document.getElementById(placeholderId);
    if (!img || !placeholder) return;

    if (dataUri && dataUri.indexOf('data:image/') === 0) {
      img.src = dataUri;
      img.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      img.style.display = 'none';
      placeholder.style.display = 'block';
    }
  }

  function populateSelect(selectId, items, defaultLabel, getValFn, getTextFn) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const previousValue = select.value;

    select.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = defaultLabel;
    select.appendChild(defaultOpt);

    items.forEach(function (item) {
      const opt = document.createElement('option');
      opt.value = getValFn(item);
      opt.textContent = getTextFn(item);
      select.appendChild(opt);
    });

    if (previousValue && Array.from(select.options).some(function (o) { return o.value === previousValue; })) {
      select.value = previousValue;
    }
  }

  /* ==================== نافذة الاختيار الذكي لوصف المخالفة ==================== */
  function bindViolationPicker() {
    const triggerBtn = document.getElementById('violationPickerTrigger');
    const modal = document.getElementById('violationPickerModal');
    const closeBtn = document.getElementById('violationPickerClose');
    const searchInput = document.getElementById('violationPickerSearch');

    if (!triggerBtn || !modal) return;

    triggerBtn.addEventListener('click', openViolationPicker);

    if (closeBtn) {
      closeBtn.addEventListener('click', closeViolationPicker);
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeViolationPicker();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('open')) {
        closeViolationPicker();
      }
    });

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        renderViolationPickerList(searchInput.value);
      });
    }
  }

  function openViolationPicker() {
    const modal = document.getElementById('violationPickerModal');
    const triggerBtn = document.getElementById('violationPickerTrigger');
    const searchInput = document.getElementById('violationPickerSearch');
    if (!modal) return;

    if (searchInput) searchInput.value = '';
    renderViolationPickerList('');

    modal.classList.add('open');
    if (triggerBtn) triggerBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';

    if (searchInput && window.innerWidth >= 768) {
      setTimeout(function () { searchInput.focus(); }, 60);
    }
  }

  function closeViolationPicker() {
    const modal = document.getElementById('violationPickerModal');
    const triggerBtn = document.getElementById('violationPickerTrigger');
    if (!modal) return;

    modal.classList.remove('open');
    if (triggerBtn) triggerBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  function renderViolationPickerList(queryText) {
    const listEl = document.getElementById('violationPickerList');
    if (!listEl) return;

    const allItems = (window.APP_STATE.settings && window.APP_STATE.settings.violationTypes) || [];
    const selectedId = document.getElementById('violationTypeId').value;
    const normQuery = normalizeArabicForSearch(queryText);

    const filtered = allItems.filter(function (item) {
      if (!normQuery) return true;
      const haystack = normalizeArabicForSearch(
        (item.violationNumber || '') + ' ' + (item.description || '') + ' ' + (item.classification || '')
      );
      return haystack.indexOf(normQuery) !== -1;
    });

    listEl.innerHTML = '';

    if (filtered.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.textAlign = 'center';
      emptyMsg.style.padding = '24px 12px';
      emptyMsg.style.color = '#64748b';
      emptyMsg.textContent = allItems.length === 0
        ? 'جارٍ تحميل قائمة المخالفات...'
        : 'لا توجد مخالفة مطابقة لعبارة البحث.';
      listEl.appendChild(emptyMsg);
      return;
    }

    filtered.forEach(function (item) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'picker-option-card' + (item.id === selectedId ? ' selected' : '');

      const meta = document.createElement('div');
      meta.className = 'picker-option-meta';

      const codeSpan = document.createElement('span');
      codeSpan.className = 'picker-option-code';
      codeSpan.textContent = item.violationNumber || '-';

      const badgeSpan = document.createElement('span');
      const clsUpper = String(item.classification || '').toUpperCase();
      badgeSpan.className = 'class-badge small' + (['A', 'B', 'C'].indexOf(clsUpper) !== -1 ? ' class-' + clsUpper : '');
      badgeSpan.textContent = item.classification ? 'تصنيف ' + item.classification : '-';

      meta.appendChild(codeSpan);
      meta.appendChild(badgeSpan);

      const descDiv = document.createElement('div');
      descDiv.className = 'picker-option-desc';
      descDiv.textContent = item.description || '';

      card.appendChild(meta);
      card.appendChild(descDiv);

      card.addEventListener('click', function () {
        selectViolationType(item);
      });

      listEl.appendChild(card);
    });
  }

  function selectViolationType(item) {
    const hiddenInput = document.getElementById('violationTypeId');
    const triggerText = document.getElementById('violationPickerText');
    const numberInput = document.getElementById('violationNumber');
    const classInput = document.getElementById('violationClassification');

    if (hiddenInput) hiddenInput.value = item.id || '';
    if (triggerText) {
      triggerText.textContent = item.description || '';
      triggerText.classList.remove('is-placeholder');
    }
    if (numberInput) numberInput.value = item.violationNumber || '';
    if (classInput) classInput.value = item.classification || '';

    updateClassificationBadge(item.classification || '');
    clearFieldError('violationTypeId');
    closeViolationPicker();
  }

  function normalizeArabicForSearch(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي')
      .replace(/[\u064B-\u065F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /* ==================== الملء التلقائي للحقول المرتبطة ==================== */
  function bindDynamicFieldListeners() {
    const contractorSelect = document.getElementById('contractorId');
    if (contractorSelect) {
      contractorSelect.addEventListener('change', function () {
        clearFieldError('contractorId');
        const id = contractorSelect.value;
        const list = (window.APP_STATE.settings && window.APP_STATE.settings.contractors) || [];
        const found = list.find(function (c) { return c.id === id; });

        document.getElementById('contractNumber').value = found ? (found.contractNumber || '-') : '';
        document.getElementById('safetyRepName').value = found ? (found.safetyRepName || '-') : '';
      });
    }

    const consultantSelect = document.getElementById('consultantId');
    if (consultantSelect) {
      consultantSelect.addEventListener('change', function () {
        clearFieldError('consultantId');
        const id = consultantSelect.value;
        const list = (window.APP_STATE.settings && window.APP_STATE.settings.engineers) || [];
        const found = list.find(function (e) { return e.id === id; });

        document.getElementById('consultantEmpNo').value = found ? (found.employeeNumber || '') : '';
      });
    }

    const refusedCheckbox = document.getElementById('contractorRefusedSign');
    const refusalWrapper = document.getElementById('refusalToggleWrapper');
    if (refusalWrapper && refusedCheckbox) {
      refusalWrapper.addEventListener('click', function (e) {
        if (e.target === refusalWrapper) {
          refusedCheckbox.checked = !refusedCheckbox.checked;
          refusedCheckbox.dispatchEvent(new Event('change'));
        }
      });

      refusedCheckbox.addEventListener('change', function () {
        const star = document.getElementById('refusalRequiredStar');
        const reasonInput = document.getElementById('refusalReason');
        if (refusedCheckbox.checked) {
          if (star) star.style.display = 'inline';
          if (reasonInput) reasonInput.setAttribute('required', 'required');
        } else {
          if (star) star.style.display = 'none';
          if (reasonInput) reasonInput.removeAttribute('required');
          clearFieldError('refusalReason');
        }
        if (window.MediaModule && typeof window.MediaModule.setContractorSignatureDisabled === 'function') {
          window.MediaModule.setContractorSignatureDisabled(refusedCheckbox.checked);
        }
      });
    }

    const watchedIds = [
      'district', 'section', 'location', 'violationDate', 'violationTime',
      'projectWoNumber', 'injuryStatus', 'permitIssuer', 'permitReceiver',
      'contractorRepName', 'contractorRepEmpNo', 'refusalReason'
    ];
    watchedIds.forEach(function (fieldId) {
      const el = document.getElementById(fieldId);
      if (!el) return;
      const evtName = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evtName, function () {
        clearFieldError(fieldId);
      });
    });
  }

  function updateClassificationBadge(cls) {
    const badge = document.getElementById('classificationBadge');
    if (!badge) return;
    badge.className = 'class-badge';
    if (!cls) {
      badge.textContent = '-';
      return;
    }
    badge.textContent = cls;
    const upper = cls.toUpperCase();
    if (upper === 'A' || upper === 'B' || upper === 'C') {
      badge.classList.add('class-' + upper);
    }
  }

  /* ==================== أزرار النموذج، الحفظ المحلي، والإرسال ==================== */
  function bindFormActions() {
    const refreshBtn = document.getElementById('refreshSettingsBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function () {
        fetchAndApplySettings(true);
      });
    }

    const resetBtn = document.getElementById('resetFormBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetFormFields);
    }

    const form = document.getElementById('violationForm');
    if (form) {
      form.addEventListener('submit', handleFormSubmit);
    }
  }

  function handleFormSubmit(e) {
    e.preventDefault();
    hideGlobalAlert();

    const validation = validateViolationForm();
    let mediaValidation = { valid: true, firstErrorEl: null };
    if (window.MediaModule && typeof window.MediaModule.validateMedia === 'function') {
      mediaValidation = window.MediaModule.validateMedia();
    }

    if (!validation.valid || !mediaValidation.valid) {
      showGlobalAlert('error', 'يرجى استكمال جميع الحقول والصور والتوقيعات الإلزامية المحددة باللون الأحمر.');
      const targetEl = validation.firstErrorEl || mediaValidation.firstErrorEl;
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof targetEl.focus === 'function') targetEl.focus();
      }
      return;
    }

    const submitBtn = document.getElementById('submitViolationBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'جارٍ الحفظ...';
    }

    const basePayload = collectFormPayload();
    const mediaPromise = (window.MediaModule && typeof window.MediaModule.getMediaPayload === 'function')
      ? window.MediaModule.getMediaPayload()
      : Promise.resolve(null);

    mediaPromise
      .then(function (mediaPayload) {
        if (window.SyncModule && typeof window.SyncModule.enqueueAndSend === 'function') {
          return window.SyncModule.enqueueAndSend(basePayload, mediaPayload);
        }

        const initialStatus = navigator.onLine
          ? window.LocalDB.STATUS.PENDING
          : window.LocalDB.STATUS.SAVED_LOCALLY;

        return window.LocalDB.saveSubmission(basePayload, mediaPayload, initialStatus)
          .then(function (savedRecord) {
            resetFormFields();
            refreshQueueUI();
            showGlobalAlert('success', 'تم حفظ المخالفة محلياً بنجاح.');
            window.scrollTo({ top: 0, behavior: 'smooth' });
          });
      })
      .catch(function (err) {
        console.error('Submission error:', err);
        showGlobalAlert('error', 'تعذر حفظ المخالفة محلياً: ' + (err.message || 'خطأ غير متوقع'));
      })
      .finally(function () {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'حفظ وإرسال المخالفة';
        }
      });
  }

  /* ==================== واجهة طابور الإرسالات المحلية ==================== */
  function bindQueueActions() {
    const retryAllBtn = document.getElementById('retryAllQueueBtn');
    if (retryAllBtn) {
      retryAllBtn.addEventListener('click', function () {
        if (window.SyncModule && typeof window.SyncModule.syncPendingQueue === 'function') {
          window.SyncModule.syncPendingQueue(true);
        }
      });
    }
  }

  function refreshQueueUI() {
    if (!window.LocalDB || typeof window.LocalDB.getAllSubmissions !== 'function') return;

    window.LocalDB.getAllSubmissions()
      .then(function (records) {
        const badge = document.getElementById('queueCountBadge');
        const pendingCount = records.filter(function (r) {
          return r.status !== window.LocalDB.STATUS.SENT_SUCCESS;
        }).length;
        if (badge) {
          badge.textContent = String(pendingCount > 0 ? pendingCount : records.length);
        }

        const container = document.getElementById('localQueueContainer');
        if (!container) return;

        container.innerHTML = '';
        if (records.length === 0) {
          const emptyDiv = document.createElement('div');
          emptyDiv.className = 'empty-queue-box';
          emptyDiv.textContent = 'لا توجد مخالفات محفوظة محلياً على هذا الجهاز حالياً.';
          container.appendChild(emptyDiv);
          return;
        }

        records.forEach(function (rec) {
          container.appendChild(buildQueueCard(rec));
        });
      })
      .catch(function (err) {
        console.warn('Queue render error:', err);
      });
  }

  function buildQueueCard(rec) {
    const card = document.createElement('div');
    card.className = 'queue-card';

    const top = document.createElement('div');
    top.className = 'queue-card-top';

    const statusBadge = document.createElement('span');
    statusBadge.className = 'queue-status-badge ' + getStatusCssClass(rec.status);
    statusBadge.textContent = rec.status;
    top.appendChild(statusBadge);

    if (rec.serialNumber) {
      const serialPill = document.createElement('span');
      serialPill.className = 'queue-serial-pill';
      serialPill.textContent = rec.serialNumber;
      top.appendChild(serialPill);
    }

    const details = document.createElement('div');
    details.className = 'queue-card-details';
    const d = rec.formData || {};
    const photosCount = (rec.media && rec.media.photos) ? rec.media.photos.length : 0;

    details.innerHTML =
      '<div><strong>المقاول:</strong> ' + escapeHtml(d.contractorName || '-') + '</div>' +
      '<div><strong>القسم / الدائرة:</strong> ' + escapeHtml((d.section || '-') + ' - ' + (d.district || '') + ' (' + (d.location || '') + ')') + '</div>' +
      '<div><strong>التاريخ والوقت:</strong> ' + escapeHtml((d.violationDate || '') + ' ' + (d.violationTime || '')) + '</div>' +
      '<div><strong>المخالفة / الصور:</strong> ' + escapeHtml((d.violationNumber || '-') + ' (' + photosCount + ' صور)') + '</div>';

    card.appendChild(top);
    card.appendChild(details);

    if (rec.lastError) {
      const errBox = document.createElement('div');
      errBox.className = 'queue-card-error';
      errBox.textContent = 'ملاحظة: ' + rec.lastError;
      card.appendChild(errBox);
    }

    const actions = document.createElement('div');
    actions.className = 'queue-card-actions';

    const uuidSpan = document.createElement('span');
    uuidSpan.className = 'queue-uuid-label';
    uuidSpan.textContent = 'UUID: ' + rec.uuid;
    actions.appendChild(uuidSpan);

    if (rec.status === window.LocalDB.STATUS.SENT_SUCCESS && rec.serialNumber) {
      const cleanBtn = document.createElement('button');
      cleanBtn.type = 'button';
      cleanBtn.className = 'photo-remove-btn';
      cleanBtn.textContent = 'إزالة من السجل المحلي';
      cleanBtn.addEventListener('click', function () {
        window.LocalDB.deleteConfirmedSubmission(rec.uuid).then(refreshQueueUI);
      });
      actions.appendChild(cleanBtn);
    } else {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn-outline';
      retryBtn.textContent = rec.status === window.LocalDB.STATUS.SENDING ? 'جارٍ الإرسال...' : 'إرسال / إعادة المحاولة';
      retryBtn.disabled = rec.status === window.LocalDB.STATUS.SENDING;
      retryBtn.addEventListener('click', function () {
        if (window.SyncModule && typeof window.SyncModule.sendSubmissionByUuid === 'function') {
          window.SyncModule.sendSubmissionByUuid(rec.uuid);
        }
      });
      actions.appendChild(retryBtn);
    }

    card.appendChild(actions);
    return card;
  }

  function getStatusCssClass(status) {
    const S = window.LocalDB ? window.LocalDB.STATUS : {};
    if (status === S.SAVED_LOCALLY) return 'status-saved';
    if (status === S.PENDING) return 'status-pending';
    if (status === S.SENDING) return 'status-sending';
    if (status === S.SENT_SUCCESS) return 'status-success';
    if (status === S.FAILED_RETRY) return 'status-failed';
    return 'status-saved';
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ==================== التحقق من النموذج ==================== */
  function validateViolationForm() {
    let firstErrorEl = null;
    let valid = true;

    const requiredFields = [
      { id: 'district', msg: 'يرجى اختيار الدائرة.' },
      { id: 'section', msg: 'يرجى اختيار القسم.' },
      { id: 'location', msg: 'يرجى إدخال الموقع.' },
      { id: 'violationDate', msg: 'يرجى تحديد تاريخ المخالفة.' },
      { id: 'violationTime', msg: 'يرجى تحديد وقت المخالفة.' },
      { id: 'contractorId', msg: 'يرجى اختيار اسم المقاول.' },
      { id: 'projectWoNumber', msg: 'يرجى إدخال رقم المشروع أو أمر العمل.' },
      { id: 'violationTypeId', focusId: 'violationPickerTrigger', msg: 'يرجى اختيار وصف المخالفة.' },
      { id: 'injuryStatus', msg: 'يرجى تحديد ما إذا كانت هناك إصابة.' },
      { id: 'permitIssuer', msg: 'يرجى إدخال اسم مصدر التصريح.' },
      { id: 'permitReceiver', msg: 'يرجى إدخال اسم مستلم التصريح.' },
      { id: 'consultantId', msg: 'يرجى اختيار اسم المهندس الاستشاري.' },
      { id: 'contractorRepName', msg: 'يرجى إدخال اسم مستلم المحضر للمقاول.' },
      { id: 'contractorRepEmpNo', msg: 'يرجى إدخال الرقم الوظيفي للمقاول.' }
    ];

    requiredFields.forEach(function (rule) {
      const el = document.getElementById(rule.id);
      const val = el ? String(el.value || '').trim() : '';
      if (!val) {
        valid = false;
        showFieldError(rule.id, rule.msg);
        if (!firstErrorEl) {
          firstErrorEl = document.getElementById(rule.focusId || rule.id);
        }
      } else {
        clearFieldError(rule.id);
      }
    });

    const refused = document.getElementById('contractorRefusedSign').checked;
    const reasonEl = document.getElementById('refusalReason');
    if (refused && !String(reasonEl.value || '').trim()) {
      valid = false;
      showFieldError('refusalReason', 'يجب ذكر سبب امتناع ممثل المقاول عن التوقيع.');
      if (!firstErrorEl) firstErrorEl = reasonEl;
    } else {
      clearFieldError('refusalReason');
    }

    return { valid: valid, firstErrorEl: firstErrorEl };
  }

  function collectFormPayload() {
    const settings = window.APP_STATE.settings || {};
    const contractorId = document.getElementById('contractorId').value;
    const violationTypeId = document.getElementById('violationTypeId').value;
    const consultantId = document.getElementById('consultantId').value;

    const contractorObj = (settings.contractors || []).find(function (c) { return c.id === contractorId; }) || {};
    const violationObj = (settings.violationTypes || []).find(function (v) { return v.id === violationTypeId; }) || {};
    const consultantObj = (settings.engineers || []).find(function (e) { return e.id === consultantId; }) || {};

    return {
      department: document.getElementById('department').value,
      district: document.getElementById('district').value,
      section: document.getElementById('section').value,
      location: document.getElementById('location').value.trim(),
      violationDate: document.getElementById('violationDate').value,
      violationTime: document.getElementById('violationTime').value,
      contractorName: contractorObj.name || '',
      contractNumber: contractorObj.contractNumber || '',
      safetyRepName: contractorObj.safetyRepName || '',
      projectWoNumber: document.getElementById('projectWoNumber').value.trim(),
      violationDescription: violationObj.description || '',
      violationNumber: violationObj.violationNumber || '',
      violationClassification: violationObj.classification || '',
      injuryStatus: document.getElementById('injuryStatus').value,
      permitIssuer: document.getElementById('permitIssuer').value.trim(),
      permitReceiver: document.getElementById('permitReceiver').value.trim(),
      additionalDescription: document.getElementById('additionalDescription').value.trim(),
      consultantName: consultantObj.name || '',
      consultantEmpNo: consultantObj.employeeNumber || '',
      contractorRepName: document.getElementById('contractorRepName').value.trim(),
      contractorRepEmpNo: document.getElementById('contractorRepEmpNo').value.trim(),
      contractorRefusedSign: document.getElementById('contractorRefusedSign').checked,
      refusalReason: document.getElementById('refusalReason').value.trim()
    };
  }

  function resetFormFields() {
    const form = document.getElementById('violationForm');
    if (form) form.reset();

    document.getElementById('department').value =
      (window.APP_STATE.settings && window.APP_STATE.settings.fixedDepartment) ||
      window.APP_CONFIG.DEFAULTS.FIXED_DEPARTMENT;

    document.getElementById('violationTypeId').value = '';
    const pickerText = document.getElementById('violationPickerText');
    if (pickerText) {
      pickerText.textContent = '-- اضغط هنا لاختيار وصف المخالفة أو البحث عنه --';
      pickerText.classList.add('is-placeholder');
    }

    ['contractNumber', 'safetyRepName', 'violationNumber', 'violationClassification', 'consultantEmpNo'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });

    updateClassificationBadge('');
    document.getElementById('refusalRequiredStar').style.display = 'none';
    document.getElementById('refusalReason').removeAttribute('required');

    document.querySelectorAll('.field-error').forEach(function (e) {
      e.textContent = '';
      e.classList.remove('visible');
    });
    document.querySelectorAll('.is-invalid').forEach(function (e) {
      e.classList.remove('is-invalid');
    });
    document.querySelectorAll('textarea.auto-expand').forEach(function (el) {
      el.style.height = '82px';
    });

    if (window.MediaModule && typeof window.MediaModule.resetAllMedia === 'function') {
      window.MediaModule.resetAllMedia();
    }

    setDefaultDateTime();
    hideGlobalAlert();
  }

  /* ==================== أدوات مساعدة ==================== */
  function setDefaultDateTime() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');

    const dateEl = document.getElementById('violationDate');
    const timeEl = document.getElementById('violationTime');
    if (dateEl && !dateEl.value) dateEl.value = yyyy + '-' + mm + '-' + dd;
    if (timeEl && !timeEl.value) timeEl.value = hh + ':' + min;
  }

  function showFieldError(fieldId, msg) {
    const targetId = fieldId === 'violationTypeId' ? 'violationPickerTrigger' : fieldId;
    const input = document.getElementById(targetId);
    const errEl = document.getElementById('err-' + fieldId);
    if (input) input.classList.add('is-invalid');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.add('visible');
    }
  }

  function clearFieldError(fieldId) {
    const targetId = fieldId === 'violationTypeId' ? 'violationPickerTrigger' : fieldId;
    const input = document.getElementById(targetId);
    const errEl = document.getElementById('err-' + fieldId);
    if (input) input.classList.remove('is-invalid');
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.remove('visible');
    }
  }

  function showGlobalAlert(type, message) {
    const el = document.getElementById('globalAlertBanner');
    if (!el) return;
    el.className = 'alert-banner show ' + type;
    el.textContent = message;
  }

  function hideGlobalAlert() {
    const el = document.getElementById('globalAlertBanner');
    if (!el) return;
    el.className = 'alert-banner';
    el.textContent = '';
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  window.APP_HELPERS = {
    resetFormFields: resetFormFields,
    showGlobalAlert: showGlobalAlert,
    hideGlobalAlert: hideGlobalAlert,
    refreshQueueUI: refreshQueueUI,
    switchToTab: switchToTab
  };
})();
