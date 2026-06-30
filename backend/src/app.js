'use strict';

const express = require('express');
const cors = require('cors');

const healthRouter = require('./routes/health');
const casesRouter = require('./routes/cases');
const settingsRouter = require('./routes/settings');
const ceiRouter = require('./routes/cei');
const segmentsRouter = require('./routes/segments');
const strategiesRouter = require('./routes/strategies');
const abTestsRouter = require('./routes/abTests');
const negotiatorsRouter = require('./routes/negotiators');
const gsheetRouter = require('./routes/gsheet');
const bulkRoutes = require('./routes/bulk');

/**
 * ساخت و پیکربندی اپلیکیشن Express.
 * نکته: مقداردهی دیتابیس در server.js قبل از start سرور انجام می‌شود،
 * بنابراین این فایل صرفاً به تعریف middleware و routeها می‌پردازد.
 */
function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // مسیرهای API
  app.use('/api/health', healthRouter);
  app.use('/api/cases', casesRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/cei-formulas', ceiRouter);
  app.use('/api/segments', segmentsRouter);
  app.use('/api/strategies', strategiesRouter);
  app.use('/api/ab-tests', abTestsRouter);
  app.use('/api/negotiators', negotiatorsRouter);
  app.use('/api/gsheet', gsheetRouter);
  app.use('/api/bulk', bulkRoutes);

  // مدیریت 404
  app.use((req, res) => {
    res.status(404).json({ error: 'مسیر مورد نظر یافت نشد' });
  });

  return app;
}

module.exports = createApp;
