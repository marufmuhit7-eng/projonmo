/*
 * sheet-import.js — pure helpers for importing questions from Google Sheets.
 * No DOM, no network: admin.js feeds these functions a CSV string and gets
 * back validated rows, so every rule below is unit-tested in
 * tools/sheetimport.test.js.
 *
 * Exposed as window.sheetImport:
 *   sheetUrlToCsv(url)        -> { csvUrl, fallbackUrl } | { error: 'docs'|'invalid' }
 *   parseCsv(text)            -> string[][]  (handles quotes, CRLF, BOM)
 *   mapHeaders(headerRow)     -> { field: columnIndex }   (flexible, bilingual)
 *   normalizeAnswer(v, opts)  -> 'A'|'B'|'C'|'D'|null
 *   validateRows(rows, hmap)  -> { items, errors }        (row-level reasons)
 */
(function () {
  'use strict';

  // ------------------------------------------------------------- headers
  // Every alias is compared after normHeader(): trimmed, lowercased,
  // inner whitespace collapsed. Bangla aliases included.
  var HEADER_ALIASES = {
    category:       ['category', 'categories', 'ক্যাটাগরি', 'শ্রেণি', 'শ্রেণী'],
    question:       ['question', 'question bn', 'question_bn', 'প্রশ্ন', 'প্রশ্ন (বাংলা)', 'প্রশ্ন_বাংলা'],
    question_en:    ['question_en', 'question en', 'questionen', 'প্রশ্ন (ইংরেজি)', 'প্রশ্ন_ইংরেজি'],
    option_a:       ['option_a', 'option a', 'optiona', 'a', 'অপশন_ক', 'অপশন ক', 'ক'],
    option_b:       ['option_b', 'option b', 'optionb', 'b', 'অপশন_খ', 'অপশন খ', 'খ'],
    option_c:       ['option_c', 'option c', 'optionc', 'c', 'অপশন_গ', 'অপশন গ', 'গ'],
    option_d:       ['option_d', 'option d', 'optiond', 'd', 'অপশন_ঘ', 'অপশন ঘ', 'ঘ'],
    option_a_en:    ['option_a_en', 'option a en', 'অপশন ক (ইংরেজি)'],
    option_b_en:    ['option_b_en', 'option b en', 'অপশন খ (ইংরেজি)'],
    option_c_en:    ['option_c_en', 'option c en', 'অপশন গ (ইংরেজি)'],
    option_d_en:    ['option_d_en', 'option d en', 'অপশন ঘ (ইংরেজি)'],
    correct_answer: ['correct_answer', 'correct answer', 'correctanswer', 'correct', 'answer', 'উত্তর', 'সঠিক উত্তর', 'সঠিক_উত্তর'],
    order_no:       ['order_no', 'order no', 'orderno', 'order', 'ক্রম', 'ক্রমিক', 'সিরিয়াল']
  };

  function normHeader(h) {
    return String(h == null ? '' : h)
      .replace(/^\uFEFF/, '')            // strip BOM
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /**
   * headerRow -> { category: idx, question: idx, ... } (only fields found).
   * First matching alias wins; later duplicate columns are ignored.
   */
  function mapHeaders(headerRow) {
    var found = {};
    (headerRow || []).forEach(function (cell, i) {
      var h = normHeader(cell);
      if (!h) return;
      Object.keys(HEADER_ALIASES).forEach(function (field) {
        if (found[field] !== undefined) return;               // first match only
        if (HEADER_ALIASES[field].indexOf(h) !== -1) found[field] = i;
      });
    });
    return found;
  }

  // ---------------------------------------------------------------- URL
  /**
   * Convert a Google Sheets share/edit link into its CSV export URL.
   * Keeps the gid when present (both ?gid= and #gid= forms).
   * A Google Docs link is rejected explicitly.
   */
  function sheetUrlToCsv(url) {
    var u = String(url || '').trim();
    if (!u) return { error: 'invalid' };
    if (/docs\.google\.com\/(document|docs|forms|presentation)/i.test(u)) {
      return { error: 'docs' };
    }
    var m = /spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(u);
    if (!m) return { error: 'invalid' };
    var fileId = m[1];
    var gid = null;
    var gm = /[?#&]gid=([0-9]+)/.exec(u);
    if (gm) gid = gm[1];
    var base = 'https://docs.google.com/spreadsheets/d/' + fileId;
    return {
      fileId: fileId,
      gid: gid,
      csvUrl: base + '/export?format=csv' + (gid ? '&gid=' + gid : ''),
      // gviz fallback — different CORS path, same sheet
      fallbackUrl: base + '/gviz/tq?tqx=out:csv' + (gid ? '&gid=' + gid : '')
    };
  }

  // ---------------------------------------------------------------- CSV
  /**
   * Small RFC-4180-ish CSV parser: quoted fields, escaped quotes (""),
   * commas and newlines inside quotes, \r\n and \n line ends, BOM.
   */
  function parseCsv(text) {
    var s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var i = 0;

    function pushField() { row.push(field); field = ''; }
    function pushRow() { pushField(); rows.push(row); row = []; }

    while (i < s.length) {
      var ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ',') { pushField(); i++; continue; }
      if (ch === '\r') { if (s[i + 1] === '\n') i++; pushRow(); i++; continue; }
      if (ch === '\n') { pushRow(); i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) pushRow();

    // drop fully-empty trailing rows
    return rows.filter(function (r) {
      return r.some(function (c) { return String(c).trim() !== ''; });
    });
  }

  // ------------------------------------------------------------- answers
  var BN_LETTERS = { 'ক': 'A', 'খ': 'B', 'গ': 'C', 'ঘ': 'D' };

  /**
   * Normalize an answer cell to 'A'..'D'. Accepts:
   *   A/a, ক, 1-4 (1-based), or the exact text of one of the options.
   * Returns null when unrecognised.
   */
  function normalizeAnswer(v, opts) {
    var t = String(v == null ? '' : v).trim();
    if (!t) return null;
    var up = t.toUpperCase();
    if (up === 'A' || up === 'B' || up === 'C' || up === 'D') return up;
    if (BN_LETTERS[t]) return BN_LETTERS[t];
    if (t === '1' || t === '2' || t === '3' || t === '4') return 'ABCD'[Number(t) - 1];
    var low = t.toLowerCase();
    for (var i = 0; i < (opts || []).length; i++) {
      if (String(opts[i] || '').trim().toLowerCase() === low && low !== '') return 'ABCD'[i];
    }
    return null;
  }

  // ------------------------------------------------------------ validate
  /**
   * Turn parsed CSV rows (row 0 = header) into validated items.
   * options: { categoryMode: 'sheet'|'fixed', fixedCategory: string }
   *
   * Returns { items: [...], errors: [{ row: 3, reason: '…' }] } where row is
   * the 1-based SHEET row number (header = row 1, data starts at row 2).
   */
  function validateRows(rows, hmap, options) {
    var opts = options || {};
    var items = [];
    var errors = [];
    var autoOrder = 0;

    if (hmap.question === undefined) {
      errors.push({ row: 1, reason: '“question / প্রশ্ন” কলামটি পাওয়া যায়নি' });
      return { items: items, errors: errors };
    }

    for (var r = 1; r < rows.length; r++) {
      var cells = rows[r];
      var rowNo = r + 1;                       // sheet row number (1-based)
      function cell(field) {
        var idx = hmap[field];
        return idx === undefined ? '' : String(cells[idx] == null ? '' : cells[idx]).trim();
      }

      var q = cell('question');
      var a = cell('option_a'), b = cell('option_b'), c = cell('option_c'), d = cell('option_d');

      // skip rows that are entirely empty
      if (!q && !a && !b && !c && !d) continue;

      if (!q) { errors.push({ row: rowNo, reason: 'প্রশ্ন লেখা নেই' }); continue; }
      if (!a || !b || !c || !d) { errors.push({ row: rowNo, reason: '৪টি অপশনের সবগুলোই দরকার (ক/খ/গ/ঘ)' }); continue; }

      var optsAll = [a, b, c, d];
      var ans = normalizeAnswer(cell('correct_answer'), optsAll);
      if (!ans) { errors.push({ row: rowNo, reason: 'সঠিক উত্তর A/B/C/D (বা ক/খ/গ/ঘ, বা ১-৪, বা অপশনের লেখা) হতে হবে' }); continue; }

      var category;
      if (opts.categoryMode === 'sheet') {
        category = cell('category');
        if (!category) { errors.push({ row: rowNo, reason: 'ক্যাটাগরি কলামে মান নেই (বা “Sheet-এর category কলাম” মোড বদলাও)' }); continue; }
      } else {
        category = opts.fixedCategory || 'primary';
      }

      var orderRaw = parseInt(cell('order_no'), 10);
      autoOrder++;

      items.push({
        _row: rowNo,                                // sheet row number for the preview
        category: category,
        question: q,
        question_en: cell('question_en'),
        option_a: a, option_b: b, option_c: c, option_d: d,
        option_a_en: cell('option_a_en'), option_b_en: cell('option_b_en'),
        option_c_en: cell('option_c_en'), option_d_en: cell('option_d_en'),
        correct_answer: ans,
        order_no: isNaN(orderRaw) ? autoOrder : orderRaw
      });
    }
    return { items: items, errors: errors };
  }

  window.sheetImport = {
    mapHeaders: mapHeaders,
    sheetUrlToCsv: sheetUrlToCsv,
    parseCsv: parseCsv,
    normalizeAnswer: normalizeAnswer,
    validateRows: validateRows
  };
})();
