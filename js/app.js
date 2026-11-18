/**
 * js/app.js
 * منطق واجهة المهندسين: جلب الإعدادات، الاختيار الذكي، الملء التلقائي، وربط الوسائط
 * شركة المحايد مهندسون استشاريون (MCE)
 */

(function () {
  'use strict';

  const SETTINGS_CACHE_KEY = 'MCE_PUBLIC_SETTINGS_CACHE_V1';

  window.APP_STATE = {
    settings: null,
    isLoadingSettings: false
  };

  document.addEventListener('DOMContentLoaded', initApp);

  function initApp() {
    bindConnectionMonitor();
    bindTabs();
    bindAutoExpandTextareas();
    bindDynamicFieldListeners();
    bindViolationPicker();
    bindFormActions();
    setDefaultDateTime();

    const cached = readCachedSettings();
    if (cached) {
      applySettingsToUI(cached);
    }
    fetchAndApplySettings(false);
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
        tabBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');

        document.getElementById('newViolationPanel').classList.toggle('hidden-panel', targetId !== 'newViolationPanel');
        document.getElementById('localQueuePanel').classList.toggle('hidden-panel', targetId !== 'localQueuePanel');
      });
    });
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

  /* ==================== جلب الإعدادات الديناميكية ==================== */
  function fetchAndApplySettings(isManualRefresh) {
    if (window.APP_STATE.isLoadingSettings) return;
    if (!navigator.onLine) {
      if (isManualRefresh) {
        showGlobalAlert('warning', 'لا يوجد اتصال بالإنترنت حالياً. يتم استخدام آخر إعدادات محفوظة.');
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
        saveCachedSettings(json.data);
        applySettingsToUI(json.data);
        if (isManualRefresh) {
          showGlobalAlert('success', 'تم تحديث قوائم المقاولين والمهندسين والمخالفات والشعارات من الخادم بنجاح.');
        }
      })
      .catch(function (err) {
        console.error('Settings fetch error:', err);
        if (!window.APP_STATE.settings) {
          showGlobalAlert('error', 'تعذر تحميل الإعدادات من الخادم: ' + err.message);
        } else if (isManualRefresh) {
          showGlobalAlert('warning', 'تعذر تحديث الإعدادات من الخادم حالياً؛ تم الإبقاء على النسخة المحفوظة.');
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
      'district', 'location', 'violationDate', 'violationTime',
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

  /* ==================== أزرار النموذج والتحقق ==================== */
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

    const basePayload = collectFormPayload();

    if (window.MediaModule && typeof window.MediaModule.getMediaPayload === 'function') {
      window.MediaModule.getMediaPayload().then(function (mediaPayload) {
        if (typeof window.onViolationFormValidated === 'function') {
          window.onViolationFormValidated(basePayload, mediaPayload);
          return;
        }
        const photoCount = (mediaPayload && mediaPayload.photos) ? mediaPayload.photos.length : 0;
        showGlobalAlert('success', 'تم التحقق من كامل النموذج والصور (' + photoCount + ' صور مضغوطة) والتوقيعات بنجاح! جاهز لمرحلة التخزين أوفلاين والإرسال.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      return;
    }

    if (typeof window.onViolationFormValidated === 'function') {
      window.onViolationFormValidated(basePayload, null);
    }
  }

  function validateViolationForm() {
    let firstErrorEl = null;
    let valid = true;

    const requiredFields = [
      { id: 'district', msg: 'يرجى اختيار الدائرة.' },
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

  function saveCachedSettings(data) {
    try {
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function readCachedSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  window.APP_HELPERS = {
    resetFormFields: resetFormFields,
    showGlobalAlert: showGlobalAlert,
    hideGlobalAlert: hideGlobalAlert
  };
})();
