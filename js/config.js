/**
 * js/config.js
 * الإعدادات العامة لربط واجهة المهندسين بالخادم الخلفي
 * شركة المحايد مهندسون استشاريون (MCE)
 */

window.APP_CONFIG = {
  // رابط Web App الفعلي المنشور من Google Apps Script
  API_URL: 'https://script.google.com/macros/s/AKfycbxLUleav6tVne3lWChaVN2PvlkxEJ1I8eWoDp4Sa2DxHL_SeU8z7F0zWFF_to4UJr5D/exec',

  // اسم قاعدة البيانات المحلية في المتصفح (ستُستخدم في مرحلة العمل دون اتصال)
  LOCAL_DB_NAME: 'MCE_SafetyViolationsDB',
  LOCAL_DB_VERSION: 1,

  // القيم الافتراضية الاحتياطية قبل أول اتصال بالخادم
  DEFAULTS: {
    COMPANY_NAME: 'الشركة السعودية للكهرباء (السعودية للطاقة)',
    CONSULTING_COMPANY_NAME: 'شركة المحايد مهندسون استشاريون',
    FORM_TITLE: 'محضر مخالفة سلامة للمقاولين',
    FIXED_DEPARTMENT: 'الدمام',
    MIN_PHOTOS: 1,
    MAX_PHOTOS: 5
  }
};
