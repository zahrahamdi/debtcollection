'use strict';

const express = require('express');
const router = express.Router();

// الگوی لینک معتبر Google Sheets
const SHEETS_URL_RE = /docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{10,}/;

/**
 * POST /api/gsheet/test
 * تست اتصال (Story 11.5 AC4-6). در نسخه دمو فقط صحت آدرس بررسی می‌شود؛
 * تست دسترسی واقعی به Google نیازمند اتصال سرویس در سمت سرور است.
 * body: { url }
 */
router.post('/test', (req, res) => {
  const url = (req.body?.url || '').trim();
  if (!url) {
    return res.status(400).json({ error: 'آدرس Google Sheet وارد نشده است' });
  }
  if (!SHEETS_URL_RE.test(url)) {
    return res.status(400).json({ error: 'آدرس واردشده یک لینک معتبر Google Sheets نیست' });
  }
  res.json({
    ok: true,
    message:
      'آدرس معتبر است. (در نسخه دمو فقط صحت آدرس بررسی می‌شود؛ تست دسترسی واقعی پس از اتصال سرویس Google در سمت سرور انجام خواهد شد.)',
  });
});

module.exports = router;
