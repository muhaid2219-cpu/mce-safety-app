/**
 * js/db.js
 * طبقة إدارة قاعدة البيانات المحلية IndexedDB للعمل دون اتصال (Offline-First)
 * تخزين الإعدادات، حفظ المخالفات والصور محلياً، وإدارة المعرف الفريد UUID والحالات الخمس
 * شركة المحايد مهندسون استشاريون (MCE)
 */

(function () {
  'use strict';

  const DB_NAME = (window.APP_CONFIG && window.APP_CONFIG.LOCAL_DB_NAME) || 'MCE_SafetyViolationsDB';
  const DB_VERSION = (window.APP_CONFIG && window.APP_CONFIG.LOCAL_DB_VERSION) || 1;
  const STORE_SETTINGS = 'settings_cache';
  const STORE_SUBMISSIONS = 'submissions';

  const SUBMISSION_STATUS = {
    SAVED_LOCALLY: 'محفوظة محلياً',
    PENDING: 'في انتظار الإرسال',
    SENDING: 'جارٍ الإرسال',
    SENT_SUCCESS: 'تم الإرسال بنجاح',
    FAILED_RETRY: 'فشل الإرسال - إعادة المحاولة'
  };

  let dbInstance = null;

  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('المتصفح لا يدعم IndexedDB للتخزين المحلي.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function (event) {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(STORE_SUBMISSIONS)) {
          const subStore = db.createObjectStore(STORE_SUBMISSIONS, { keyPath: 'uuid' });
          subStore.createIndex('status', 'status', { unique: false });
          subStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = function (event) {
        dbInstance = event.target.result;
        dbInstance.onversionchange = function () {
          dbInstance.close();
          dbInstance = null;
        };
        resolve(dbInstance);
      };

      request.onerror = function (event) {
        reject(event.target.error || new Error('تعذر فتح قاعدة البيانات المحلية.'));
      };
    });
  }

  /**
   * توليد معرف فريد دائم UUID v4 لكل إرسال
   */
  function generateUUID() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes).map(function (b) {
      return ('0' + b.toString(16)).slice(-2);
    });
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    );
  }

  /* ==================== تخزين الإعدادات محلياً ==================== */
  function saveSettingsCache(settingsData) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction([STORE_SETTINGS], 'readwrite');
        const store = tx.objectStore(STORE_SETTINGS);
        store.put({
          key: 'public_settings',
          data: settingsData,
          savedAt: new Date().toISOString()
        });
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function getSettingsCache() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction([STORE_SETTINGS], 'readonly');
        const store = tx.objectStore(STORE_SETTINGS);
        const req = store.get('public_settings');
        req.onsuccess = function () {
          resolve(req.result ? req.result.data : null);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  /* ==================== إدارة المخالفات المحفوظة محلياً ==================== */
  function saveSubmission(formData, mediaPayload, initialStatus) {
    const uuid = generateUUID();
    const nowIso = new Date().toISOString();

    const cleanPhotos = ((mediaPayload && mediaPayload.photos) || []).map(function (p, idx) {
      return {
        index: idx + 1,
        name: p.name || ('photo_' + (idx + 1) + '.jpg'),
        mimeType: p.mimeType || 'image/jpeg',
        sizeBytes: p.sizeBytes || 0,
        dataUrl: p.dataUrl
      };
    });

    const record = {
      uuid: uuid,
      formData: formData,
      media: {
        photos: cleanPhotos,
        consultantSignatureDataUrl: (mediaPayload && mediaPayload.consultantSignature) ? mediaPayload.consultantSignature.dataUrl : '',
        contractorSignatureDataUrl: (mediaPayload && mediaPayload.contractorSignature) ? mediaPayload.contractorSignature.dataUrl : ''
      },
      status: initialStatus || SUBMISSION_STATUS.SAVED_LOCALLY,
      serialNumber: '',
      retryCount: 0,
      lastError: '',
      createdAt: nowIso,
      updatedAt: nowIso
    };

    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction([STORE_SUBMISSIONS], 'readwrite');
        const store = tx.objectStore(STORE_SUBMISSIONS);
        store.put(record);
        tx.oncomplete = function () { resolve(record); };
        tx.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function getSubmission(uuid) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction([STORE_SUBMISSIONS], 'readonly');
        const store = tx.objectStore(STORE_SUBMISSIONS);
        const req = store.get(uuid);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function updateSubmission(uuid, patch) {
    return getSubmission(uuid).then(function (existing) {
      if (!existing) {
        throw new Error('السجل المحلي غير موجود: ' + uuid);
      }
      const updated = Object.assign({}, existing, patch, {
        updatedAt: new Date().toISOString()
      });

      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction([STORE_SUBMISSIONS], 'readwrite');
          const store = tx.objectStore(STORE_SUBMISSIONS);
          store.put(updated);
          tx.oncomplete = function () { resolve(updated); };
          tx.onerror = function (e) { reject(e.target.error); };
        });
      });
    });
  }

  function getAllSubmissions() {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction([STORE_SUBMISSIONS], 'readonly');
        const store = tx.objectStore(STORE_SUBMISSIONS);
        const req = store.getAll();
        req.onsuccess = function () {
          const rows = req.result || [];
          rows.sort(function (a, b) {
            return String(b.createdAt).localeCompare(String(a.createdAt));
          });
          resolve(rows);
        };
        req.onerror = function (e) { reject(e.target.error); };
      });
    });
  }

  function getPendingSubmissions() {
    const retryable = [
      SUBMISSION_STATUS.SAVED_LOCALLY,
      SUBMISSION_STATUS.PENDING,
      SUBMISSION_STATUS.FAILED_RETRY
    ];
    return getAllSubmissions().then(function (rows) {
      return rows.filter(function (r) {
        return retryable.indexOf(r.status) !== -1;
      });
    });
  }

  /**
   * حذف سجل تم تأكيد إرساله بنجاح فقط لتفريغ السجل يدوياً من جهاز المهندس
   */
  function deleteConfirmedSubmission(uuid) {
    return getSubmission(uuid).then(function (existing) {
      if (!existing) return false;
      if (existing.status !== SUBMISSION_STATUS.SENT_SUCCESS || !existing.serialNumber) {
        throw new Error('ممنوع حذف أي مخالفة قبل تأكيد الخادم لحفظها وإصدار الرقم التسلسلي.');
      }
      return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction([STORE_SUBMISSIONS], 'readwrite');
          const store = tx.objectStore(STORE_SUBMISSIONS);
          store.delete(uuid);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function (e) { reject(e.target.error); };
        });
      });
    });
  }

  window.LocalDB = {
    STATUS: SUBMISSION_STATUS,
    openDB: openDB,
    generateUUID: generateUUID,
    saveSettingsCache: saveSettingsCache,
    getSettingsCache: getSettingsCache,
    saveSubmission: saveSubmission,
    getSubmission: getSubmission,
    updateSubmission: updateSubmission,
    getAllSubmissions: getAllSubmissions,
    getPendingSubmissions: getPendingSubmissions,
    deleteConfirmedSubmission: deleteConfirmedSubmission
  };
})();
