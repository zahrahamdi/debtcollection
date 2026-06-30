'use strict';

const express = require('express');
const router = express.Router();

// GET /api/health — تست سلامت سرویس
router.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = router;
