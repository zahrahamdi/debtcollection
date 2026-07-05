'use strict';

const express = require('express');
const { authenticate, requireAdmin } = require('./middleware/auth.middleware');

const healthRouter = require('./routes/health');
const authRouter = require('./routes/auth.routes');
const usersRouter = require('./routes/users.routes');
const casesRouter = require('./routes/cases');
const settingsRouter = require('./routes/settings');
const ceiRouter = require('./routes/cei');
const segmentsRouter = require('./routes/segments');
const strategiesRouter = require('./routes/strategies');
const abTestsRouter = require('./routes/abTests');
const negotiatorsRouter = require('./routes/negotiators');
const gsheetRouter = require('./routes/gsheet');
const bulkRoutes = require('./routes/bulk');
const reportsRoutes = require('./routes/reports');
const debtorsRoutes = require('./routes/debtors');
const installmentsRoutes = require('./routes/installments');

/**
 * ساخت و پیکربندی اپلیکیشن Express.
 */
function createApp() {
  const app = express();

  app.use(require('cors')());
  app.use(express.json());

  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);

  app.use('/api/cases', authenticate, casesRouter);
  app.use('/api/cases', authenticate, installmentsRoutes);
  app.use('/api/debtors', authenticate, debtorsRoutes);
  app.use('/api/negotiators', authenticate, negotiatorsRouter);
  app.use('/api/gsheet', authenticate, gsheetRouter);

  app.use('/api/settings', authenticate, settingsRouter);
  app.use('/api/cei-formulas', authenticate, requireAdmin, ceiRouter);
  app.use('/api/segments', authenticate, segmentsRouter);
  app.use('/api/strategies', authenticate, strategiesRouter);
  app.use('/api/ab-tests', authenticate, requireAdmin, abTestsRouter);
  app.use('/api/bulk', authenticate, bulkRoutes);
  app.use('/api/reports', authenticate, reportsRoutes);
  app.use('/api/users', authenticate, usersRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'مسیر مورد نظر یافت نشد' });
  });

  return app;
}

module.exports = createApp;
