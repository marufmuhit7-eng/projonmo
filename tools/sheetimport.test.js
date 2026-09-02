/*
 * sheetimport.test.js — pure helpers behind the Google Sheet question
 * importer (src/shared/sheet-import.js): URL conversion, CSV parsing,
 * bilingual header mapping, answer normalisation and row validation.
 *
 * Run:  node tools/sheetimport.test.js
 */
'use strict';

global.window = {};
require('../src/shared/sheet-import.js');
const SI = global.window.sheetImport;

let passed = 0;
let failed = 0;
function check(label, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + label); }
  else { failed++; console.log('  FAIL ' + label + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : '')); }
}

(function run() {
  console.log('sheet-import — URL · CSV · headers · validation\n');

  // ---- URL conversion -----------------------------------------------------
  const full = SI.sheetUrlToCsv('https://docs.google.com/spreadsheets/d/FILE123/edit#gid=42');
  check('edit link with #gid keeps the gid',
    full.csvUrl === 'https://docs.google.com/spreadsheets/d/FILE123/export?format=csv&gid=42', full);
  check('gviz fallback built too', /gviz\/tq\?tqx=out:csv&gid=42$/.test(full.fallbackUrl), full);
  const q = SI.sheetUrlToCsv('https://docs.google.com/spreadsheets/d/FILE123/edit?usp=sharing');
  check('link without gid exports the default sheet',
    q.csvUrl === 'https://docs.google.com/spreadsheets/d/FILE123/export?format=csv', q);
  check('Google Docs link is rejected explicitly',
    SI.sheetUrlToCsv('https://docs.google.com/document/d/XYZ/edit').error === 'docs');
  check('non-sheet URL is invalid', SI.sheetUrlToCsv('https://example.com/x.csv').error === 'invalid');

  // ---- CSV parsing ----------------------------------------------------------
  const simple = SI.parseCsv('a,b,c\n1,"2,x",3\n"line\nbreak","quote""d",');
  check('parses 3 rows', simple.length === 3, simple);
  check('quoted comma stays one field', simple[1][1] === '2,x');
  check('quoted newline preserved', simple[2][0] === 'line\nbreak');
  check('escaped quote becomes one"', simple[2][1] === 'quote"d');
  check('trailing empty field kept', simple[2][2] === '');
  check('CRLF and BOM tolerated',
    SI.parseCsv('\uFEFFh1,h2\r\nv1,v2\r\n')[1][0] === 'v1');
  check('fully empty rows dropped',
    SI.parseCsv('a,b\n\n   \nc,d').length === 2);

  // ---- header mapping -------------------------------------------------------
  const en = SI.mapHeaders(['Category', 'Question', 'Option_A', 'Option_B', 'Option_C', 'Option_D', 'Correct', 'Order']);
  check('english variants map (case-insensitive)',
    en.category === 0 && en.question === 1 && en.option_a === 2 && en.correct_answer === 6 && en.order_no === 7, en);
  const bn = SI.mapHeaders(['ক্যাটাগরি', 'প্রশ্ন', 'অপশন_ক', 'অপশন_খ', 'অপশন_গ', 'অপশন_ঘ', 'উত্তর', 'ক্রম']);
  check('bangla variants map',
    bn.category === 0 && bn.question === 1 && bn.option_d === 5 && bn.correct_answer === 6 && bn.order_no === 7, bn);
  check('missing column simply absent from the map',
    SI.mapHeaders(['question', 'a', 'b', 'c', 'd']).category === undefined);

  // ---- answer normalisation -------------------------------------------------
  check('A stays A', SI.normalizeAnswer('A', []) === 'A');
  check('lowercase b -> B', SI.normalizeAnswer('b', []) === 'B');
  check('bangla গ -> C', SI.normalizeAnswer('গ', []) === 'C');
  check('numeric 4 -> D', SI.normalizeAnswer('4', []) === 'D');
  check('option text matched', SI.normalizeAnswer('নীলফামারী', ['রংপুর', 'নীলফামারী', 'ঢাকা', 'খুলনা']) === 'B');
  check('garbage -> null', SI.normalizeAnswer('ভুল', ['ক', 'খ', 'গ', 'ঘ']) === null);
  check('empty -> null', SI.normalizeAnswer('', ['ক', 'খ', 'গ', 'ঘ']) === null);

  // ---- row validation -------------------------------------------------------
  const rows = [
    ['category', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct_answer', 'order_no'],
    ['primary', 'প্রশ্ন ১', 'ক', 'খ', 'গ', 'ঘ', 'C', '2'],       // valid, custom order
    ['junior', 'প্রশ্ন ২', 'ক', 'খ', 'গ', 'ঘ', 'ক'],              // valid, bangla answer
    ['', 'প্রশ্ন ৩', 'ক', 'খ', 'গ', 'ঘ', 'A', ''],                // sheet mode: no category -> error
    ['primary', '', 'ক', 'খ', 'গ', 'ঘ', 'A', ''],                 // no question -> error
    ['primary', 'প্রশ্ন ৫', 'ক', '', 'গ', 'ঘ', 'A', ''],          // missing option -> error
    ['primary', 'প্রশ্ন ৬', 'ক', 'খ', 'গ', 'ঘ', 'Z', ''],         // bad answer -> error
    ['', '', '', '', '', '', '', ''],                               // empty row -> skipped silently
    ['senior', 'প্রশ্ন ৮', 'ক', 'খ', 'গ', 'ঘ', '3', '']          // numeric answer -> valid
  ];
  const hmap = SI.mapHeaders(rows[0]);

  const sheetMode = SI.validateRows(rows, hmap, { categoryMode: 'sheet' });
  check('sheet mode: 3 valid items', sheetMode.items.length === 3, sheetMode.items.length);
  check('sheet mode: 4 row-level errors', sheetMode.errors.length === 4, sheetMode.errors.length);
  check('errors carry the 1-based sheet row number',
    sheetMode.errors.some(e => e.row === 4 && /ক্যাটাগরি/.test(e.reason)), sheetMode.errors);
  check('bangla answer normalised to A', sheetMode.items.some(i => i.question === 'প্রশ্ন ২' && i.correct_answer === 'A'));
  check('numeric answer normalised to C', sheetMode.items.some(i => i.question === 'প্রশ্ন ৮' && i.correct_answer === 'C'));
  check('explicit order_no kept', sheetMode.items[0].order_no === 2);
  check('items remember their sheet row', sheetMode.items[0]._row === 2);

  const fixedMode = SI.validateRows(rows, hmap, { categoryMode: 'fixed', fixedCategory: 'senior' });
  check('fixed mode: row 3 becomes valid with the chosen category',
    fixedMode.items.length === 4 && fixedMode.items.some(i => i.question === 'প্রশ্ন ৩' && i.category === 'senior'),
    fixedMode.items.length);

  const noQ = SI.validateRows([['a', 'b', 'c', 'd', 'e'], ['x', 'y', 'z', 'w', 'v']], {}, {});
  check('header without a question column is reported on row 1',
    noQ.items.length === 0 && noQ.errors.length >= 1 && noQ.errors[0].row === 1, noQ);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
