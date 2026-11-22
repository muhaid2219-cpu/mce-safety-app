/**
 * js/media.js
 * ضغط الصور، التصوير المباشر بالكاميرا، المعاينة، ورسم ورفع التوقيعات
 * شركة المحايد مهندسون استشاريون (MCE)
 */

(function () {
  'use strict';

  const MAX_PHOTO_DIMENSION = 960;
  const PHOTO_JPEG_QUALITY = 0.78;
  const MAX_SIG_WIDTH = 600;
  const MAX_SIG_HEIGHT = 260;

  const state = {
    photos: [], // [{ id, name, sizeBytes, mimeType, dataUrl, blob }]
    signatures: {
      consultant: {
        mode: 'draw', // draw | upload
        hasDrawn: false,
        uploadedDataUrl: '',
        uploadedBlob: null,
        canvas: null,
        ctx: null
      },
      contractor: {
        mode: 'draw',
        hasDrawn: false,
        uploadedDataUrl: '',
        uploadedBlob: null,
        canvas: null,
        ctx: null,
        disabled: false
      }
    }
  };

  document.addEventListener('DOMContentLoaded', initMediaModule);

  function initMediaModule() {
    bindPhotoControls();
    initSignaturePad('consultant');
    initSignaturePad('contractor');
  }

  /* ==================== 1. إدارة الصور والضغط ==================== */
  function bindPhotoControls() {
    const cameraBtn = document.getElementById('btnCaptureCamera');
    const galleryBtn = document.getElementById('btnPickGallery');
    const cameraInput = document.getElementById('photoCameraInput');
    const galleryInput = document.getElementById('photoGalleryInput');

    if (cameraBtn && cameraInput) {
      cameraBtn.addEventListener('click', function () {
        cameraInput.value = '';
        cameraInput.click();
      });
      cameraInput.addEventListener('change', function () {
        handleSelectedPhotoFiles(cameraInput.files);
      });
    }

    if (galleryBtn && galleryInput) {
      galleryBtn.addEventListener('click', function () {
        galleryInput.value = '';
        galleryInput.click();
      });
      galleryInput.addEventListener('change', function () {
        handleSelectedPhotoFiles(galleryInput.files);
      });
    }
  }

  function getPhotoLimits() {
    const s = (window.APP_STATE && window.APP_STATE.settings) || {};
    return {
      min: parseInt(s.minPhotos, 10) || (window.APP_CONFIG && window.APP_CONFIG.DEFAULTS.MIN_PHOTOS) || 1,
      max: parseInt(s.maxPhotos, 10) || (window.APP_CONFIG && window.APP_CONFIG.DEFAULTS.MAX_PHOTOS) || 5
    };
  }

  function handleSelectedPhotoFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    const limits = getPhotoLimits();
    const files = Array.from(fileList);
    const remaining = limits.max - state.photos.length;

    if (remaining <= 0) {
      showMediaError('err-photos', 'تم الوصول للحد الأقصى المسموح به للصور (' + limits.max + ' صور). احذف صورة لإضافة غيرها.');
      return;
    }

    clearMediaError('err-photos');
    const filesToProcess = files.slice(0, remaining);
    if (files.length > remaining) {
      showMediaError('err-photos', 'تم قبول أول ' + remaining + ' صور فقط لأن الحد الأقصى هو ' + limits.max + ' صور.');
    }

    setPhotoProcessingState(true);

    Promise.all(filesToProcess.map(compressPhotoFile))
      .then(function (results) {
        results.forEach(function (item) {
          if (item) state.photos.push(item);
        });
        renderPhotosPreview();
      })
      .catch(function (err) {
        console.error('Photo compression error:', err);
        showMediaError('err-photos', 'تعذر معالجة إحدى الصور. تأكد من أن الملف صورة صالحة.');
      })
      .finally(function () {
        setPhotoProcessingState(false);
      });
  }

  function compressPhotoFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        reject(new Error('الملف ليس صورة صالحة.'));
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      img.onload = function () {
        try {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;

          if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
            if (width >= height) {
              height = Math.round((height * MAX_PHOTO_DIMENSION) / width);
              width = MAX_PHOTO_DIMENSION;
            } else {
              width = Math.round((width * MAX_PHOTO_DIMENSION) / height);
              height = MAX_PHOTO_DIMENSION;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(objectUrl);
            if (!blob) {
              reject(new Error('فشل ضغط الصورة.'));
              return;
            }
            blobToDataUrl(blob).then(function (dataUrl) {
              resolve({
                id: 'ph_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                name: file.name || 'violation_photo.jpg',
                sizeBytes: blob.size,
                mimeType: 'image/jpeg',
                dataUrl: dataUrl,
                blob: blob
              });
            }).catch(reject);
          }, 'image/jpeg', PHOTO_JPEG_QUALITY);
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };

      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('تعذر قراءة الصورة.'));
      };

      img.src = objectUrl;
    });
  }

  function renderPhotosPreview() {
    const grid = document.getElementById('photosPreviewGrid');
    const countBadge = document.getElementById('photosCountBadge');
    const limits = getPhotoLimits();

    if (countBadge) {
      countBadge.textContent = state.photos.length + ' / ' + limits.max + ' صور';
    }
    if (!grid) return;

    grid.innerHTML = '';

    state.photos.forEach(function (photo, index) {
      const card = document.createElement('div');
      card.className = 'photo-preview-card';

      const img = document.createElement('img');
      img.src = photo.dataUrl;
      img.alt = 'صورة المخالفة ' + (index + 1);

      const footer = document.createElement('div');
      footer.className = 'photo-preview-footer';

      const info = document.createElement('span');
      info.className = 'photo-preview-meta';
      const kb = Math.max(1, Math.round(photo.sizeBytes / 1024));
      info.textContent = 'صورة ' + (index + 1) + ' (' + kb + ' KB)';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'photo-remove-btn';
      delBtn.textContent = 'حذف';
      delBtn.addEventListener('click', function () {
        removePhotoById(photo.id);
      });

      footer.appendChild(info);
      footer.appendChild(delBtn);
      card.appendChild(img);
      card.appendChild(footer);
      grid.appendChild(card);
    });
  }

  function removePhotoById(photoId) {
    state.photos = state.photos.filter(function (p) { return p.id !== photoId; });
    renderPhotosPreview();
    if (state.photos.length >= getPhotoLimits().min) {
      clearMediaError('err-photos');
    }
  }

  function setPhotoProcessingState(isBusy) {
    const statusEl = document.getElementById('photosProcessingMsg');
    if (statusEl) {
      statusEl.style.display = isBusy ? 'block' : 'none';
    }
  }

  /* ==================== 2. إدارة لوحات التوقيع (رسم + رفع صورة) ==================== */
  function initSignaturePad(role) {
    const pad = state.signatures[role];
    const canvas = document.getElementById(role + 'SigCanvas');
    const drawTabBtn = document.getElementById(role + 'SigTabDraw');
    const uploadTabBtn = document.getElementById(role + 'SigTabUpload');
    const clearBtn = document.getElementById(role + 'SigClearBtn');
    const fileInput = document.getElementById(role + 'SigFileInput');
    const pickFileBtn = document.getElementById(role + 'SigPickFileBtn');

    if (!canvas) return;

    pad.canvas = canvas;
    pad.ctx = canvas.getContext('2d');
    setupCanvasResolution(role);

    // منع تحريك الشاشة أثناء الرسم بالإصبع
    canvas.style.touchAction = 'none';

    let isDrawing = false;
    let lastPoint = null;

    function getCanvasPoint(e) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }

    canvas.addEventListener('pointerdown', function (e) {
      if (pad.disabled || pad.mode !== 'draw') return;
      e.preventDefault();
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      }
      isDrawing = true;
      lastPoint = getCanvasPoint(e);
      pad.ctx.beginPath();
      pad.ctx.arc(lastPoint.x, lastPoint.y, 1.2, 0, Math.PI * 2);
      pad.ctx.fillStyle = '#0f172a';
      pad.ctx.fill();
      pad.hasDrawn = true;
      clearSignatureError(role);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!isDrawing || pad.disabled || pad.mode !== 'draw') return;
      e.preventDefault();
      const pt = getCanvasPoint(e);
      pad.ctx.beginPath();
      pad.ctx.moveTo(lastPoint.x, lastPoint.y);
      pad.ctx.lineTo(pt.x, pt.y);
      pad.ctx.strokeStyle = '#0f172a';
      pad.ctx.lineWidth = 2.6;
      pad.ctx.lineCap = 'round';
      pad.ctx.lineJoin = 'round';
      pad.ctx.stroke();
      lastPoint = pt;
      pad.hasDrawn = true;
    });

    function endStroke(e) {
      if (!isDrawing) return;
      isDrawing = false;
      lastPoint = null;
      if (canvas.releasePointerCapture && e && e.pointerId !== undefined) {
        try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
      }
    }

    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);

    // إعادة ضبط دقة اللوحة عند تغيير حجم الشاشة فقط إذا كانت فارغة (حتى لا يُمسح التوقيع)
    window.addEventListener('resize', function () {
      if (!pad.hasDrawn) {
        setupCanvasResolution(role);
      }
    });

    if (drawTabBtn) {
      drawTabBtn.addEventListener('click', function () {
        if (pad.disabled) return;
        switchSignatureMode(role, 'draw');
      });
    }

    if (uploadTabBtn) {
      uploadTabBtn.addEventListener('click', function () {
        if (pad.disabled) return;
        switchSignatureMode(role, 'upload');
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        clearSignature(role);
      });
    }

    if (pickFileBtn && fileInput) {
      pickFileBtn.addEventListener('click', function () {
        if (pad.disabled) return;
        fileInput.value = '';
        fileInput.click();
      });

      fileInput.addEventListener('change', function () {
        if (!fileInput.files || !fileInput.files[0]) return;
        compressSignatureImage(fileInput.files[0])
          .then(function (res) {
            pad.uploadedDataUrl = res.dataUrl;
            pad.uploadedBlob = res.blob;
            const previewImg = document.getElementById(role + 'SigUploadPreview');
            const emptyHint = document.getElementById(role + 'SigUploadEmpty');
            if (previewImg) {
              previewImg.src = res.dataUrl;
              previewImg.style.display = 'block';
            }
            if (emptyHint) emptyHint.style.display = 'none';
            clearSignatureError(role);
          })
          .catch(function () {
            showMediaError('err-' + role + 'Signature', 'تعذر قراءة صورة التوقيع. اختر صورة صالحة.');
          });
      });
    }
  }

  function setupCanvasResolution(role) {
    const pad = state.signatures[role];
    const canvas = pad.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || (canvas.parentElement ? canvas.parentElement.clientWidth : 320) || 320;
    const cssH = rect.height || 160;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    pad.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function switchSignatureMode(role, mode) {
    const pad = state.signatures[role];
    pad.mode = mode;

    const drawTabBtn = document.getElementById(role + 'SigTabDraw');
    const uploadTabBtn = document.getElementById(role + 'SigTabUpload');
    const drawWrap = document.getElementById(role + 'SigDrawArea');
    const uploadWrap = document.getElementById(role + 'SigUploadArea');

    if (drawTabBtn) drawTabBtn.classList.toggle('active', mode === 'draw');
    if (uploadTabBtn) uploadTabBtn.classList.toggle('active', mode === 'upload');
    if (drawWrap) drawWrap.style.display = mode === 'draw' ? 'block' : 'none';
    if (uploadWrap) uploadWrap.style.display = mode === 'upload' ? 'block' : 'none';

    if (mode === 'draw' && !pad.hasDrawn) {
      setupCanvasResolution(role);
    }
  }

  function clearSignature(role) {
    const pad = state.signatures[role];
    if (!pad) return;

    if (pad.canvas && pad.ctx) {
      setupCanvasResolution(role);
      pad.hasDrawn = false;
    }

    pad.uploadedDataUrl = '';
    pad.uploadedBlob = null;

    const previewImg = document.getElementById(role + 'SigUploadPreview');
    const emptyHint = document.getElementById(role + 'SigUploadEmpty');
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (emptyHint) emptyHint.style.display = 'block';
    clearSignatureError(role);
  }

  function compressSignatureImage(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !file.type || file.type.indexOf('image/') !== 0) {
        reject(new Error('Invalid signature file'));
        return;
      }
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        try {
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          const ratio = Math.min(MAX_SIG_WIDTH / w, MAX_SIG_HEIGHT / h, 1);
          w = Math.max(1, Math.round(w * ratio));
          h = Math.max(1, Math.round(h * ratio));

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          canvas.toBlob(function (blob) {
            URL.revokeObjectURL(objectUrl);
            if (!blob) {
              reject(new Error('Failed to encode signature'));
              return;
            }
            blobToDataUrl(blob).then(function (dataUrl) {
              resolve({ blob: blob, dataUrl: dataUrl });
            }).catch(reject);
          }, 'image/png');
        } catch (err) {
          URL.revokeObjectURL(objectUrl);
          reject(err);
        }
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Image load error'));
      };
      img.src = objectUrl;
    });
  }

  function hasSignatureValue(role) {
    const pad = state.signatures[role];
    if (!pad) return false;
    if (pad.mode === 'draw') return pad.hasDrawn;
    return Boolean(pad.uploadedDataUrl);
  }

  function exportSignature(role) {
    const pad = state.signatures[role];
    if (!pad || !hasSignatureValue(role)) {
      return Promise.resolve(null);
    }
    if (pad.mode === 'upload') {
      return Promise.resolve({
        mimeType: 'image/png',
        dataUrl: pad.uploadedDataUrl,
        blob: pad.uploadedBlob
      });
    }
    return new Promise(function (resolve) {
      pad.canvas.toBlob(function (blob) {
        if (!blob) {
          resolve(null);
          return;
        }
        blobToDataUrl(blob).then(function (dataUrl) {
          resolve({
            mimeType: 'image/png',
            dataUrl: dataUrl,
            blob: blob
          });
        });
      }, 'image/png');
    });
  }

  function setContractorSignatureDisabled(isDisabled) {
    const pad = state.signatures.contractor;
    pad.disabled = Boolean(isDisabled);
    const box = document.getElementById('contractorSignatureBox');
    if (box) {
      box.classList.toggle('is-disabled', pad.disabled);
    }
    if (pad.disabled) {
      clearSignature('contractor');
    }
  }

  /* ==================== 3. التحقق والاستخراج والتفريغ ==================== */
  function validateMedia() {
    const limits = getPhotoLimits();
    let valid = true;
    let firstErrorEl = null;

    if (state.photos.length < limits.min) {
      valid = false;
      showMediaError('err-photos', 'إرفاق صور المخالفة إلزامي (الحد الأدنى ' + limits.min + ' صورة).');
      firstErrorEl = document.getElementById('photosSectionContainer');
    } else if (state.photos.length > limits.max) {
      valid = false;
      showMediaError('err-photos', 'الحد الأقصى المسموح به للصور هو ' + limits.max + ' صور.');
      firstErrorEl = document.getElementById('photosSectionContainer');
    } else {
      clearMediaError('err-photos');
    }

    if (!hasSignatureValue('consultant')) {
      valid = false;
      showMediaError('err-consultantSignature', 'توقيع المهندس الاستشاري إلزامي (بالرسم أو برفع صورة).');
      if (!firstErrorEl) firstErrorEl = document.getElementById('consultantSignatureBox');
    } else {
      clearSignatureError('consultant');
    }

    const refusedCheckbox = document.getElementById('contractorRefusedSign');
    const isRefused = refusedCheckbox ? refusedCheckbox.checked : false;
    if (!isRefused && !hasSignatureValue('contractor')) {
      valid = false;
      showMediaError('err-contractorSignature', 'يرجى أخذ توقيع ممثل المقاول أو تفعيل خيار الامتناع عن التوقيع.');
      if (!firstErrorEl) firstErrorEl = document.getElementById('contractorSignatureBox');
    } else {
      clearSignatureError('contractor');
    }

    return { valid: valid, firstErrorEl: firstErrorEl };
  }

  function getMediaPayload() {
    return Promise.all([
      exportSignature('consultant'),
      exportSignature('contractor')
    ]).then(function (sigs) {
      return {
        photos: state.photos.slice(),
        consultantSignature: sigs[0],
        contractorSignature: sigs[1]
      };
    });
  }

  function resetAllMedia() {
    state.photos = [];
    renderPhotosPreview();
    clearMediaError('err-photos');

    switchSignatureMode('consultant', 'draw');
    clearSignature('consultant');

    setContractorSignatureDisabled(false);
    switchSignatureMode('contractor', 'draw');
    clearSignature('contractor');
  }

  /* ==================== أدوات مساعدة ==================== */
  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onloadend = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function showMediaError(errId, msg) {
    const el = document.getElementById(errId);
    if (el) {
      el.textContent = msg;
      el.classList.add('visible');
    }
  }

  function clearMediaError(errId) {
    const el = document.getElementById(errId);
    if (el) {
      el.textContent = '';
      el.classList.remove('visible');
    }
  }

  function clearSignatureError(role) {
    clearMediaError('err-' + role + 'Signature');
  }

  window.MediaModule = {
    validateMedia: validateMedia,
    getMediaPayload: getMediaPayload,
    resetAllMedia: resetAllMedia,
    setContractorSignatureDisabled: setContractorSignatureDisabled
  };
})();
