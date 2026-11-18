/**
 * js/sync.js
 * محرك المزامنة الآمنة، منع التكرار بـ UUID، وإدارة حالات الإرسال الخمس
 * شركة المحايد مهندسون استشاريون (MCE)
 */

(function () {
  'use strict';

  const inFlightUuids = new Set();
  let isQueueSyncRunning = false;

  document.addEventListener('DOMContentLoaded', initSyncModule);

  function initSyncModule() {
    window.addEventListener('online', function () {
      syncPendingQueue(false);
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        syncPendingQueue(false);
      }
    });

    // محاولة إرسال أي مخالفات معلقة فور فتح التطبيق إذا كان الإنترنت متوفراً
    setTimeout(function () {
      if (navigator.onLine) {
        syncPendingQueue(false);
      }
    }, 1500);
  }

  /**
   * حفظ المخالفة محلياً أولاً بـ UUID دائم، ثم محاولة الإرسال الفوري عند توفر الإنترنت
   */
  function enqueueAndSend(formData, mediaPayload) {
    const initialStatus = navigator.onLine
      ? window.LocalDB.STATUS.PENDING
      : window.LocalDB.STATUS.SAVED_LOCALLY;

    return window.LocalDB.saveSubmission(formData, mediaPayload, initialStatus)
      .then(function (savedRecord) {
        if (window.APP_HELPERS) {
          window.APP_HELPERS.resetFormFields();
          window.APP_HELPERS.refreshQueueUI();
        }

        if (!navigator.onLine) {
          if (window.APP_HELPERS) {
            window.APP_HELPERS.showGlobalAlert(
              'warning',
              'أنت غير متصل بالإنترنت: تم حفظ المخالفة والصور بأمان على جهازك (' + window.LocalDB.STATUS.SAVED_LOCALLY + '). سيتم إرسالها عند عودة الاتصال.'
            );
          }
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return savedRecord;
        }

        return sendSubmissionByUuid(savedRecord.uuid, { showBanner: true });
      });
  }

  /**
   * إرسال مخالفة واحدة محددة عبر الـ UUID
   */
  function sendSubmissionByUuid(uuid, options) {
    const opts = options || { showBanner: true };

    if (!navigator.onLine) {
      if (opts.showBanner && window.APP_HELPERS) {
        window.APP_HELPERS.showGlobalAlert('warning', 'لا يوجد اتصال بالإنترنت حالياً؛ المخالفة محفوظة بأمان على جهازك.');
      }
      return Promise.resolve({ ok: false, offline: true });
    }

    if (inFlightUuids.has(uuid)) {
      return Promise.resolve({ ok: false, inFlight: true });
    }

    const apiUrl = window.APP_CONFIG && window.APP_CONFIG.API_URL;
    if (!apiUrl || apiUrl.indexOf('http') !== 0) {
      return Promise.reject(new Error('رابط الخادم API_URL غير مضبوط.'));
    }

    return window.LocalDB.getSubmission(uuid).then(function (record) {
      if (!record) {
        throw new Error('لم يتم العثور على السجل المحلي.');
      }
      if (record.status === window.LocalDB.STATUS.SENT_SUCCESS && record.serialNumber) {
        return { ok: true, serialNumber: record.serialNumber, alreadySent: true };
      }

      inFlightUuids.add(uuid);

      return window.LocalDB.updateSubmission(uuid, {
        status: window.LocalDB.STATUS.SENDING,
        lastError: ''
      })
      .then(function () {
        if (window.APP_HELPERS) window.APP_HELPERS.refreshQueueUI();

        const requestBody = JSON.stringify({
          action: 'submitViolation',
          data: {
            submissionUuid: record.uuid,
            formData: record.formData,
            media: record.media
          }
        });

        // استخدام text/plain لتفادي قيود CORS preflight مع Google Apps Script
        return fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: requestBody
        });
      })
      .then(function (resp) {
        if (!resp.ok) {
          throw new Error('استجابة خادم غير صالحة: HTTP ' + resp.status);
        }
        return resp.json();
      })
      .then(function (json) {
        if (!json || !json.success || !json.data || !json.data.serialNumber) {
          throw new Error((json && json.error) || 'لم يؤكد الخادم حفظ السجل وإصدار الرقم التسلسلي.');
        }

        const assignedSerial = json.data.serialNumber;
        return window.LocalDB.updateSubmission(uuid, {
          status: window.LocalDB.STATUS.SENT_SUCCESS,
          serialNumber: assignedSerial,
          lastError: ''
        }).then(function () {
          if (window.APP_HELPERS) {
            window.APP_HELPERS.refreshQueueUI();
            if (opts.showBanner) {
              const dupNote = json.data.duplicate ? ' (تم تأكيد السجل السابق بدون تكرار)' : '';
              window.APP_HELPERS.showGlobalAlert(
                'success',
                'تم الإرسال والحفظ في قاعدة البيانات بنجاح! الرقم التسلسلي الرسمي: ' + assignedSerial + dupNote
              );
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }
          return { ok: true, serialNumber: assignedSerial };
        });
      })
      .catch(function (err) {
        const errMsg = err && err.message ? err.message : 'تعذر الاتصال بالخادم';
        return window.LocalDB.updateSubmission(uuid, {
          status: window.LocalDB.STATUS.FAILED_RETRY,
          retryCount: (record.retryCount || 0) + 1,
          lastError: errMsg
        }).then(function () {
          if (window.APP_HELPERS) {
            window.APP_HELPERS.refreshQueueUI();
            if (opts.showBanner) {
              window.APP_HELPERS.showGlobalAlert(
                'warning',
                'تعذر إرسال المخالفة حالياً (' + errMsg + ')، لكنها محفوظة بأمان على جهازك ويمكنك إعادة المحاولة من سجل الإرسالات.'
              );
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }
          return { ok: false, error: errMsg };
        });
      })
      .finally(function () {
        inFlightUuids.delete(uuid);
      });
    });
  }

  /**
   * إرسال جميع المخالفات المعلقة أو التي فشل إرسالها سابقاً بالتسلسل
   */
  function syncPendingQueue(isManual) {
    if (!navigator.onLine) {
      if (isManual && window.APP_HELPERS) {
        window.APP_HELPERS.showGlobalAlert('warning', 'لا يوجد اتصال بالإنترنت حالياً؛ جميع المخالفات محفوظة بأمان على جهازك.');
      }
      return Promise.resolve();
    }

    if (isQueueSyncRunning) {
      return Promise.resolve();
    }

    isQueueSyncRunning = true;
    const retryAllBtn = document.getElementById('retryAllQueueBtn');
    if (retryAllBtn) {
      retryAllBtn.disabled = true;
      retryAllBtn.textContent = 'جارٍ مزامنة المعلقات...';
    }

    const succeededSerials = [];

    return window.LocalDB.getPendingSubmissions()
      .then(function (pendingList) {
        if (!pendingList || pendingList.length === 0) {
          if (isManual && window.APP_HELPERS) {
            window.APP_HELPERS.showGlobalAlert('info', 'لا توجد مخالفات معلقة بانتظار الإرسال حالياً.');
          }
          return;
        }

        // إرسال بالتسلسل لضمان الاستقرار ومنع ضغط الشبكة بالصور الكبيرة
        let chain = Promise.resolve();
        pendingList.forEach(function (rec) {
          chain = chain.then(function () {
            return sendSubmissionByUuid(rec.uuid, { showBanner: false }).then(function (res) {
              if (res && res.ok && res.serialNumber) {
                succeededSerials.push(res.serialNumber);
              }
            });
          });
        });

        return chain.then(function () {
          if (window.APP_HELPERS) {
            window.APP_HELPERS.refreshQueueUI();
            if (succeededSerials.length > 0) {
              window.APP_HELPERS.showGlobalAlert(
                'success',
                'تم إرسال ' + succeededSerials.length + ' مخالفة معلقة بنجاح! الأرقام التسلسلية: ' + succeededSerials.join(' ، ')
              );
            } else if (isManual) {
              window.APP_HELPERS.showGlobalAlert(
                'warning',
                'تعذر إرسال بعض المخالفات المعلقة؛ راجع التفاصيل أسفل كل بطاقة.'
              );
            }
          }
        });
      })
      .finally(function () {
        isQueueSyncRunning = false;
        if (retryAllBtn) {
          retryAllBtn.disabled = false;
          retryAllBtn.textContent = 'إرسال / إعادة المحاولة للمعلقات';
        }
      });
  }

  window.SyncModule = {
    enqueueAndSend: enqueueAndSend,
    sendSubmissionByUuid: sendSubmissionByUuid,
    syncPendingQueue: syncPendingQueue
  };
})();
