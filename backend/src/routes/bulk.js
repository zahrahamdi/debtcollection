'use strict';

const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { query, run } = require('../db/database');
const { importCasesFromRows, MAX_ROWS } = require('../services/case-import.service');
const { importPaymentsFromRows } = require('../services/payment-import.service');
const { deleteDebtorByMobile, deleteAllExceptMobile } = require('../services/debtor-cleanup.service');
const {
  bulkAssignFromRows,
  bulkReassignFromRows,
  MAX_ROWS: BULK_ASSIGN_MAX_ROWS,
} = require('../services/bulk-assign.service');

const { getActorName } = require('../utils/requestUser');

const router = express.Router();

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
  if (fail === 0) return 'success';
  if (success === 0) return 'failed';
  return 'partial';
}

/**
 * POST /api/bulk/upload-cases
 * body (multipart): file, user_name (optional)
 */
router.post('/upload-cases', upload.single('file'), (req, res) => {
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

    const { lastInsertRowid } = run(
      `INSERT INTO bulk_operations (user_name, operation_type, total_count, status)
       VALUES ($user, 'upload_cases', $total, 'processing')`,
      { $user: userName, $total: rows.length }
    );
    bulkId = lastInsertRowid;

    const result = importCasesFromRows(rows, userName);
    const successCount = result.created + result.updated;
    const failCount = result.errors.length;
    const status = operationStatus(result.total, successCount, failCount);

    const errorReport = {
      errors: result.errors,
      error_rows: result.error_rows,
    };

    run(
      `UPDATE bulk_operations SET success_count = $s, fail_count = $f, status = $st,
       error_report = $er, completed_at = datetime('now') WHERE id = $id`,
      {
        $s: successCount,
        $f: failCount,
        $st: status,
        $er: JSON.stringify(errorReport),
        $id: bulkId,
      }
    );

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
    if (bulkId) {
      run(
        `UPDATE bulk_operations SET status = 'failed', fail_count = total_count,
         error_report = $er, completed_at = datetime('now') WHERE id = $id`,
        { $er: JSON.stringify({ errors: [{ reason: err.message }] }), $id: bulkId }
      );
    }
    res.status(400).json({ error: err.message || 'خطا در پردازش فایل Excel' });
  }
});

/**
 * POST /api/bulk/upload-payments
 * body (multipart): file, user_name (optional)
 */
router.post('/upload-payments', upload.single('file'), (req, res) => {
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

    const { lastInsertRowid } = run(
      `INSERT INTO bulk_operations (user_name, operation_type, total_count, status)
       VALUES ($user, 'upload_payments', $total, 'processing')`,
      { $user: userName, $total: rows.length }
    );
    bulkId = lastInsertRowid;

    const result = importPaymentsFromRows(rows, userName);
    const status = operationStatus(result.total, result.success_count, result.fail_count);

    const errorReport = {
      errors: result.errors,
      error_rows: result.error_rows,
    };

    run(
      `UPDATE bulk_operations SET success_count = $s, fail_count = $f, status = $st,
       error_report = $er, completed_at = datetime('now') WHERE id = $id`,
      {
        $s: result.success_count,
        $f: result.fail_count,
        $st: status,
        $er: JSON.stringify(errorReport),
        $id: bulkId,
      }
    );

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
    if (bulkId) {
      run(
        `UPDATE bulk_operations SET status = 'failed', fail_count = total_count,
         error_report = $er, completed_at = datetime('now') WHERE id = $id`,
        { $er: JSON.stringify({ errors: [{ reason: err.message }] }), $id: bulkId }
      );
    }
    res.status(400).json({ error: err.message || 'خطا در پردازش فایل Excel پرداخت‌ها' });
  }
});

function finishBulkOperation(bulkId, result, operationType) {
  const status = operationStatus(result.total, result.success_count, result.fail_count);
  const errorReport = {
    errors: result.errors,
    error_rows: result.error_rows,
  };

  run(
    `UPDATE bulk_operations SET success_count = $s, fail_count = $f, status = $st,
     error_report = $er, completed_at = datetime('now') WHERE id = $id`,
    {
      $s: result.success_count,
      $f: result.fail_count,
      $st: status,
      $er: JSON.stringify(errorReport),
      $id: bulkId,
    }
  );

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
router.post('/assign-cases', upload.single('file'), (req, res) => {
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

    const { lastInsertRowid } = run(
      `INSERT INTO bulk_operations (user_name, operation_type, total_count, status)
       VALUES ($user, 'bulk_assign', $total, 'processing')`,
      { $user: userName, $total: rows.length }
    );
    bulkId = lastInsertRowid;

    const result = bulkAssignFromRows(rows, userName);
    res.json(finishBulkOperation(bulkId, result));
  } catch (err) {
    console.error('[POST /api/bulk/assign-cases]', err);
    if (bulkId) {
      run(
        `UPDATE bulk_operations SET status = 'failed', fail_count = total_count,
         error_report = $er, completed_at = datetime('now') WHERE id = $id`,
        { $er: JSON.stringify({ errors: [{ reason: err.message }] }), $id: bulkId }
      );
    }
    res.status(400).json({ error: err.message || 'خطا در پردازش فایل تخصیص گروهی' });
  }
});

/**
 * POST /api/bulk/reassign-cases
 * body (multipart): file, user_name (optional)
 */
router.post('/reassign-cases', upload.single('file'), (req, res) => {
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

    const { lastInsertRowid } = run(
      `INSERT INTO bulk_operations (user_name, operation_type, total_count, status)
       VALUES ($user, 'bulk_reassign', $total, 'processing')`,
      { $user: userName, $total: rows.length }
    );
    bulkId = lastInsertRowid;

    const result = bulkReassignFromRows(rows, userName);
    res.json(finishBulkOperation(bulkId, result));
  } catch (err) {
    console.error('[POST /api/bulk/reassign-cases]', err);
    if (bulkId) {
      run(
        `UPDATE bulk_operations SET status = 'failed', fail_count = total_count,
         error_report = $er, completed_at = datetime('now') WHERE id = $id`,
        { $er: JSON.stringify({ errors: [{ reason: err.message }] }), $id: bulkId }
      );
    }
    res.status(400).json({ error: err.message || 'خطا در پردازش فایل تخصیص مجدد گروهی' });
  }
});

/**
 * POST /api/bulk/delete-all-except-mobile
 * body: { mobile: "09128898006" } — حذف همه پرونده‌ها جز بدهکار با این موبایل
 */
router.post('/delete-all-except-mobile', (req, res) => {
  try {
    const mobile = req.body?.mobile || req.query?.mobile;
    if (!mobile) {
      return res.status(400).json({ error: 'شماره موبایل الزامی است' });
    }
    const result = deleteAllExceptMobile(mobile);
    if (!result.ok) {
      return res.status(404).json({ error: result.error });
    }
    res.json({
      message: 'همه پرونده‌ها حذف شدند؛ فقط بدهکار مشخص‌شده باقی ماند',
      kept: result.kept,
      kept_cases: result.kept_cases,
      removed_debtors: result.removed_debtors,
      deleted: result.deleted,
    });
  } catch (err) {
    console.error('[POST /api/bulk/delete-all-except-mobile]', err);
    res.status(500).json({ error: 'خطا در حذف پرونده‌ها' });
  }
});

/**
 * POST /api/bulk/delete-debtor-by-mobile
 * body: { mobile: "09128898006" } — حذف بدهکار و پرونده‌های مرتبط (ادمین دمو)
 */
router.post('/delete-debtor-by-mobile', (req, res) => {
  try {
    const mobile = req.body?.mobile || req.query?.mobile;
    if (!mobile) {
      return res.status(400).json({ error: 'شماره موبایل الزامی است' });
    }
    const result = deleteDebtorByMobile(mobile);
    if (!result.found) {
      return res.status(404).json({ error: 'بدهکاری با این شماره موبایل یافت نشد' });
    }
    res.json({
      message: 'بدهکار و پرونده‌های مرتبط حذف شدند',
      matched: result.matched,
      deleted: result.deleted,
    });
  } catch (err) {
    console.error('[POST /api/bulk/delete-debtor-by-mobile]', err);
    res.status(500).json({ error: 'خطا در حذف بدهکار' });
  }
});

/**
 * GET /api/bulk/history
 * query: user_name (optional — PRD: هر کاربر تاریخچه خود را می‌بیند)
 */
router.get('/history', (req, res) => {
  try {
    const userName = req.query.user_name;
    let rows;
    if (userName) {
      rows = query(
        `SELECT id, user_name, operation_type, total_count, success_count, fail_count,
                status, created_at, completed_at
         FROM bulk_operations WHERE user_name = $user ORDER BY created_at DESC`,
        { $user: userName }
      );
    } else {
      rows = query(
        `SELECT id, user_name, operation_type, total_count, success_count, fail_count,
                status, created_at, completed_at
         FROM bulk_operations ORDER BY created_at DESC`
      );
    }

    const data = rows.map((r) => ({
      ...r,
      operation_label: operationTypeLabel(r.operation_type),
      status_label: statusLabel(r.status),
      has_error_report: r.fail_count > 0,
    }));

    res.json({ data });
  } catch (err) {
    console.error('[GET /api/bulk/history]', err);
    res.status(500).json({ error: 'خطا در دریافت تاریخچه عملیات گروهی' });
  }
});

/**
 * GET /api/bulk/error-report/:id
 * دانلود فایل Excel خطاها
 */
router.get('/error-report/:id', (req, res) => {
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
    console.error('[GET /api/bulk/error-report/:id]', err);
    res.status(500).json({ error: 'خطا در تولید گزارش خطا' });
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
