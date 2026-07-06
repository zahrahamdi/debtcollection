'use strict';

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { query, run } = require('../db/database');
const { nowDatetime } = require('../db/dateUtil');
const { importCasesFromRows, MAX_ROWS } = require('../services/case-import.service');
const { importPaymentsFromRows } = require('../services/payment-import.service');
const {
  bulkAssignFromRows,
  bulkReassignFromRows,
  MAX_ROWS: BULK_ASSIGN_MAX_ROWS,
} = require('../services/bulk-assign.service');

const { getActorName } = require('../utils/requestUser');
const { authorize } = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authorize('bulk_operations', 'view'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.originalname.match(/\.xlsx?$/i);
    cb(ok ? null : new Error('فقط فایل Excel (.xlsx / .xls) مجاز است'), ok);
  },
});

function parseExcelBuffer(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('فایل Excel فاقد Sheet است');
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
}

function buildErrorWorkbook(errorRows) {
  const ws = XLSX.utils.json_to_sheet(errorRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'خطاها');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function operationStatus(total, success, fail) {
  if (success === 0 && fail === 0) return total > 0 ? 'failed' : 'failed';
  if (fail === 0 && success > 0) return 'success';
  if (success === 0) return 'failed';
  return 'partial';
}

function insertBulkOperation(userName, operationType, totalCount) {
  const createdAt = nowDatetime();
  const { lastInsertRowid } = run(
    `INSERT INTO bulk_operations (user_name, operation_type, total_count, status, created_at)
     VALUES ($user, $type, $total, 'processing', $ca)`,
    { $user: userName, $type: operationType, $total: totalCount, $ca: createdAt }
  );
  return lastInsertRowid;
}

function completeBulkOperation(bulkId, { successCount, failCount, status, errorReport }) {
  run(
    `UPDATE bulk_operations SET success_count = $s, fail_count = $f, status = $st,
     error_report = $er, completed_at = $ca WHERE id = $id`,
    {
      $s: successCount,
      $f: failCount,
      $st: status,
      $er: JSON.stringify(errorReport),
      $ca: nowDatetime(),
      $id: bulkId,
    }
  );
}

function failBulkOperation(bulkId, reason) {
  run(
    `UPDATE bulk_operations SET status = 'failed', fail_count = total_count,
     error_report = $er, completed_at = $ca WHERE id = $id`,
    {
      $er: JSON.stringify({ errors: [{ reason }] }),
      $ca: nowDatetime(),
      $id: bulkId,
    }
  );
}

/**
 * POST /api/bulk/upload-cases
 * body (multipart): file, user_name (optional)
 */
router.post('/upload-cases', upload.single('file'), (req, res, next) => {
  let bulkId = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'فایل Excel ارسال نشده است' });
    }

    const userName = getActorName(req);
    const rows = parseExcelBuffer(req.file.buffer);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'فایل Excel خالی است' });
    }
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ error: `حداکثر ${MAX_ROWS} ردیف در هر فایل قابل پردازش است` });
    }

    bulkId = insertBulkOperation(userName, 'upload_cases', rows.length);

    const result = importCasesFromRows(rows, userName);
    const successCount = result.created + result.updated;
    const failCount = result.errors.length;
    const status = operationStatus(result.total, successCount, failCount);

    const errorReport = {
      errors: result.errors,
      error_rows: result.error_rows,
    };

    completeBulkOperation(bulkId, {
      successCount,
      failCount,
      status,
      errorReport,
    });

    res.json({
      bulk_id: bulkId,
      total: result.total,
      created: result.created,
      updated: result.updated,
      success_count: successCount,
      fail_count: failCount,
      status,
      errors: result.errors,
      has_error_report: failCount > 0,
    });
  } catch (err) {
    console.error('[POST /api/bulk/upload-cases]', err);
    if (bulkId) failBulkOperation(bulkId, err.message);
    next(err.status ? err : Object.assign(err, { status: 400 }));
  }
});

/**
 * POST /api/bulk/upload-payments
 * body (multipart): file, user_name (optional)
 */
router.post('/upload-payments', upload.single('file'), (req, res, next) => {
  let bulkId = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'فایل Excel ارسال نشده است' });
    }

    const userName = getActorName(req);
    const rows = parseExcelBuffer(req.file.buffer);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'فایل Excel خالی است' });
    }
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ error: `حداکثر ${MAX_ROWS} ردیف در هر فایل قابل پردازش است` });
    }

    bulkId = insertBulkOperation(userName, 'upload_payments', rows.length);

    const result = importPaymentsFromRows(rows, userName);

    if (result.total === 0) {
      failBulkOperation(bulkId, 'فایل Excel فاقد ردیف داده معتبر است');
      return res.status(400).json({ error: 'فایل Excel فاقد ردیف داده معتبر است' });
    }

    if (result.total !== rows.length) {
      run('UPDATE bulk_operations SET total_count = $t WHERE id = $id', {
        $t: result.total,
        $id: bulkId,
      });
    }

    const status = operationStatus(result.total, result.success_count, result.fail_count);

    const errorReport = {
      errors: result.errors,
      error_rows: result.error_rows,
    };

    completeBulkOperation(bulkId, {
      successCount: result.success_count,
      failCount: result.fail_count,
      status,
      errorReport,
    });

    res.json({
      bulk_id: bulkId,
      total: result.total,
      success_count: result.success_count,
      fail_count: result.fail_count,
      full_count: result.full_count,
      partial_count: result.partial_count,
      status,
      errors: result.errors,
      has_error_report: result.fail_count > 0,
    });
  } catch (err) {
    console.error('[POST /api/bulk/upload-payments]', err);
    if (bulkId) failBulkOperation(bulkId, err.message);
    next(err.status ? err : Object.assign(err, { status: 400 }));
  }
});

function finishBulkOperation(bulkId, result) {
  const status = operationStatus(result.total, result.success_count, result.fail_count);
  const errorReport = {
    errors: result.errors,
    error_rows: result.error_rows,
  };

  completeBulkOperation(bulkId, {
    successCount: result.success_count,
    failCount: result.fail_count,
    status,
    errorReport,
  });

  return {
    bulk_id: bulkId,
    total: result.total,
    success_count: result.success_count,
    fail_count: result.fail_count,
    status,
    errors: result.errors,
    has_error_report: result.fail_count > 0,
  };
}

/**
 * POST /api/bulk/assign-cases
 * body (multipart): file, user_name (optional)
 */
router.post('/assign-cases', upload.single('file'), (req, res, next) => {
  let bulkId = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'فایل Excel ارسال نشده است' });
    }

    const userName = getActorName(req);
    const rows = parseExcelBuffer(req.file.buffer);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'فایل Excel خالی است' });
    }
    if (rows.length > BULK_ASSIGN_MAX_ROWS) {
      return res.status(400).json({
        error: `حداکثر ${BULK_ASSIGN_MAX_ROWS} ردیف در هر فایل قابل پردازش است`,
      });
    }

    bulkId = insertBulkOperation(userName, 'bulk_assign', rows.length);

    const result = bulkAssignFromRows(rows, userName);
    res.json(finishBulkOperation(bulkId, result));
  } catch (err) {
    console.error('[POST /api/bulk/assign-cases]', err);
    if (bulkId) failBulkOperation(bulkId, err.message);
    next(err.status ? err : Object.assign(err, { status: 400 }));
  }
});

/**
 * POST /api/bulk/reassign-cases
 * body (multipart): file, user_name (optional)
 */
router.post('/reassign-cases', upload.single('file'), (req, res, next) => {
  let bulkId = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'فایل Excel ارسال نشده است' });
    }

    const userName = getActorName(req);
    const rows = parseExcelBuffer(req.file.buffer);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'فایل Excel خالی است' });
    }
    if (rows.length > BULK_ASSIGN_MAX_ROWS) {
      return res.status(400).json({
        error: `حداکثر ${BULK_ASSIGN_MAX_ROWS} ردیف در هر فایل قابل پردازش است`,
      });
    }

    bulkId = insertBulkOperation(userName, 'bulk_reassign', rows.length);

    const result = bulkReassignFromRows(rows, userName);
    res.json(finishBulkOperation(bulkId, result));
  } catch (err) {
    console.error('[POST /api/bulk/reassign-cases]', err);
    if (bulkId) failBulkOperation(bulkId, err.message);
    next(err.status ? err : Object.assign(err, { status: 400 }));
  }
});

/**
 * GET /api/bulk/history
 * query: user_name (optional — PRD: هر کاربر تاریخچه خود را می‌بیند)
 */
router.get('/history', (req, res, next) => {
  try {
    const userName = req.query.user_name;
    let rows;
    if (userName) {
      rows = query(
        `SELECT id, user_name, operation_type, total_count, success_count, fail_count,
                status, created_at, completed_at
         FROM bulk_operations WHERE user_name = $user ORDER BY completed_at DESC, created_at DESC`,
        { $user: userName }
      );
    } else {
      rows = query(
        `SELECT id, user_name, operation_type, total_count, success_count, fail_count,
                status, created_at, completed_at
         FROM bulk_operations ORDER BY completed_at DESC, created_at DESC`
      );
    }

    const data = rows.map((r) => ({
      ...r,
      operation_label: operationTypeLabel(r.operation_type),
      status_label: statusLabel(r.status),
      has_error_report: r.fail_count > 0,
      performed_at: r.completed_at || r.created_at,
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/bulk/error-report/:id
 * دانلود فایل Excel خطاها
 */
router.get('/error-report/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const rows = query('SELECT error_report, operation_type FROM bulk_operations WHERE id = $id', {
      $id: id,
    });
    if (rows.length === 0) return res.status(404).json({ error: 'عملیات یافت نشد' });

    const report = rows[0].error_report ? JSON.parse(rows[0].error_report) : null;
    const errorRows = report?.error_rows || [];
    if (errorRows.length === 0) {
      return res.status(404).json({ error: 'گزارش خطایی برای این عملیات وجود ندارد' });
    }

    const buffer = buildErrorWorkbook(errorRows);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bulk-errors-${id}.xlsx"`
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

function operationTypeLabel(type) {
  const map = {
    upload_cases: 'بارگذاری پرونده‌ها',
    upload_payments: 'بارگذاری پرداخت‌ها',
    bulk_assign: 'تخصیص گروهی',
    bulk_reassign: 'تخصیص مجدد گروهی',
  };
  return map[type] || type;
}

function statusLabel(status) {
  const map = {
    processing: 'در حال انجام',
    success: 'موفق',
    partial: 'موفق جزئی',
    failed: 'ناموفق',
  };
  return map[status] || status;
}

module.exports = router;
