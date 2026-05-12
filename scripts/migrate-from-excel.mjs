#!/usr/bin/env node
/**
 * One-off migration: pulls historical transactions out of the source
 * Excel (docs/Vođenje troškova.xlsx) and writes them into Firestore.
 *
 * Each "year" sheet (UPISIVANJE 2020, …, Upisivanje 2026.) is parsed
 * as a sequence of 9-row month blocks. Five week-rows per block
 * (labelled I–V). Each populated cell in columns D-onward contains
 * either a plain number or a sum formula like `=1500+800-200`; each
 * additive term becomes a separate transaction document. Subtractive
 * terms (refunds, corrections) are preserved as negative amounts.
 *
 * Column → category mapping is rebuilt per sheet from rows 2 + 3
 * (group / sub-category headers), because the column layout shifted
 * over the years (KARTICE split in 2025+, KOZMETIKA / KIRIJA only in
 * pre-2024 sheets, etc.). Sub-categories that don't match the seeded
 * taxonomy are folded into the closest fit (KOZMETIKA → hemikalije,
 * KIRIJA → stan, TRENING → telo, etc.).
 *
 * Every imported doc is stamped with `imported: true` + `importedAt`
 * so a future cleanup can find and delete them. Running the script
 * twice on the same household aborts unless --force is passed.
 *
 * Usage:
 *   pnpm migrate -- --email=<your-email> --dry-run
 *   pnpm migrate -- --email=<your-email>
 *   pnpm migrate -- --email=<your-email> --clean       # wipe prior imports first
 *   pnpm migrate -- --email=<your-email> --wipe-all    # wipe EVERYTHING first (incl. manual)
 *
 * Requires firebase-admin-key.json at the repo root (download from
 * Firebase Console → Project Settings → Service accounts).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import XLSX from 'xlsx';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';

// --------------------------------- CLI ---------------------------------

const args = parseArgs(process.argv.slice(2));
if (!args.email) {
  console.error('Usage: pnpm migrate -- --email=<your-email> [--dry-run] [--clean | --wipe-all] [--force] [--yes]');
  process.exit(2);
}
const DRY_RUN = !!args['dry-run'];
const FORCE = !!args.force;
const ASSUME_YES = !!args.yes;
// --clean: wipe existing imported=true transactions before re-importing.
// Manually-logged transactions (no imported flag) are preserved.
const CLEAN = !!args.clean;
// --wipe-all: wipe EVERY transaction in the household before re-importing.
// Destructive — includes manually-logged entries. Use for a true fresh start.
const WIPE_ALL = !!args['wipe-all'];

if (CLEAN && WIPE_ALL) {
  console.error('Use either --clean OR --wipe-all, not both.');
  process.exit(2);
}

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

// --------------------------------- Init --------------------------------

const KEY_PATH = path.resolve('firebase-admin-key.json');
if (!existsSync(KEY_PATH)) {
  console.error(`Missing service-account key at ${KEY_PATH}`);
  console.error('Download from Firebase Console → Project Settings → Service accounts.');
  process.exit(2);
}
const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const auth = getAuth();

// --------------------------------- Lookup ------------------------------

const userRecord = await auth.getUserByEmail(args.email).catch(err => {
  console.error(`Could not find user with email ${args.email}: ${err.message}`);
  process.exit(2);
});
console.log(`✓ Found user: ${userRecord.displayName ?? userRecord.email} (uid: ${userRecord.uid})`);

const householdsSnap = await db
  .collection('households')
  .where('members', 'array-contains', userRecord.uid)
  .get();

if (householdsSnap.empty) {
  console.error(`No household found for ${args.email}. Create one in the app first.`);
  process.exit(2);
}
if (householdsSnap.size > 1) {
  console.error(`Multiple households for ${args.email}. Disambiguation not yet supported.`);
  process.exit(2);
}
const householdDoc = householdsSnap.docs[0];
const householdId = householdDoc.id;
const householdName = householdDoc.data().name;
console.log(`✓ Found household: "${householdName}" (id: ${householdId})`);

// Count existing transactions — used for guardrails and summary.
const txCol = db.collection('households').doc(householdId).collection('transactions');
const existingImportedSnap = await txCol.where('imported', '==', true).get();
const existingImportedCount = existingImportedSnap.size;

// Fetch all docs only when --wipe-all (otherwise we don't need them).
const allExistingSnap = WIPE_ALL ? await txCol.get() : null;
const allExistingCount = allExistingSnap?.size ?? 0;
const manuallyLoggedCount = WIPE_ALL ? allExistingCount - existingImportedCount : 0;

// Discover existing budget docs across all yyyymm sub-collections.
// We don't have a flat collection — Firestore stores them as
// households/{hid}/budgets/{yyyymm}/categories/{cid}. listDocuments()
// gives us refs to every yyyymm doc (including ones that exist purely
// as parents of a sub-collection).
const budgetMonthRefs = (CLEAN || WIPE_ALL)
  ? await db.collection('households').doc(householdId).collection('budgets').listDocuments()
  : [];

let existingImportedBudgetRefs = [];
let allExistingBudgetRefs = [];
let manualBudgetCount = 0;

if (CLEAN) {
  // Collect category docs with imported=true across every yyyymm.
  for (const monthDoc of budgetMonthRefs) {
    const snap = await monthDoc.collection('categories').where('imported', '==', true).get();
    for (const d of snap.docs) existingImportedBudgetRefs.push(d.ref);
  }
}

if (WIPE_ALL) {
  // Collect every category doc + every yyyymm parent ref.
  for (const monthDoc of budgetMonthRefs) {
    const snap = await monthDoc.collection('categories').get();
    let importedHere = 0;
    for (const d of snap.docs) {
      allExistingBudgetRefs.push(d.ref);
      if (d.data().imported === true) importedHere++;
    }
    manualBudgetCount += snap.size - importedHere;
    // The yyyymm parent doc itself may carry startingAmount etc. —
    // delete it too for a true reset.
    allExistingBudgetRefs.push(monthDoc);
  }
}

// Refuse to double-import unless an explicit wipe / force flag is set.
if (existingImportedCount > 0 && !FORCE && !CLEAN && !WIPE_ALL) {
  console.error(
    `This household already contains ${existingImportedCount} imported transactions.\n` +
    `  --clean      wipe prior imports and re-import (manual transactions preserved)\n` +
    `  --wipe-all   delete EVERY transaction (incl. manual) and re-import\n` +
    `  --force      import on top of existing (creates duplicates)`,
  );
  process.exit(2);
}

// --------------------------------- Mapping -----------------------------

/**
 * Maps an Excel (GROUP, SUBCAT) header pair to one of our seeded
 * category IDs. Returns null for columns we should ignore (totals,
 * savings).
 */
function mapToCategoryId(group, subcat) {
  const g = group.toUpperCase();
  if (g === 'TROŠKOVI' || g === 'ŠTEDNJA' || g.startsWith('KRAJNJE') || g === 'POČETNO STANJE') {
    return null;
  }
  const key = `${g}/${subcat}`.toLowerCase();
  const map = {
    // 2024+ canonical
    'mi/ulaganja': 'mi-ulaganja',
    'mi/um': 'mi-um',
    'mi/telo': 'mi-telo',
    'nana/rsd': 'nana',
    'kredit/rsd': 'kredit',
    'kartice/rate': 'kartice-rate',
    'kartice/hrana': 'kartice-hrana',
    'kartice/pokloni': 'kartice-pokloni',
    'kartice/rsd': 'kartice-rate',           // older sheets had a single KARTICE column
    'računi/rsd': 'racuni',
    'racuni/rsd': 'racuni',
    'auto/rsd': 'auto',
    'hrana/market': 'hrana-market',
    'hrana/restoran': 'hrana-restoran',
    'pokloni/rsd': 'pokloni',
    'kozmetika/rsd': 'ostalo-hemikalije',    // cosmetics → drugstore (closest fit)
    'kirija/rsd': 'ostalo-stan',             // rent → housing
    'psihoterapija/rsd': 'mi-um',            // therapy → mind
    'trening/rsd': 'mi-telo',                // training → body
    'ostalo/stan': 'ostalo-stan',
    'ostalo/hemikalije': 'ostalo-hemikalije',
    'ostalo/kafe, voda i to': 'ostalo-kafe',
    'ostalo/kafe i voda': 'ostalo-kafe',
    'ostalo/majke': 'ostalo-majke',
    'ostalo/ostalo': 'ostalo-ostalo',
    'ostalo/cuvanje': 'ostalo-ostalo',       // childcare → catch-all
    'ostalo/trebinje': 'ostalo-ostalo',      // travel → catch-all
    'ostalo/edukacija': 'mi-um',             // education → mind
    'ostalo/garderoba': 'ostalo-ostalo',     // clothing → catch-all
    'ostalo/bosna': 'ostalo-ostalo',         // travel → catch-all
  };
  if (map[key]) return map[key];
  return null;
}

/**
 * Builds a `{ columnLetter → categoryId }` map for a given sheet by
 * reading rows 2 (group) + 3 (sub-category). Group cells are sticky:
 * an empty group cell inherits from the column to its left.
 */
function buildColumnMap(ws) {
  const out = {};
  const unmatched = [];
  let currentGroup = '';
  for (let c = 3; c <= 22; c++) {
    const cl = XLSX.utils.encode_col(c);
    const g = String(ws[cl + '2']?.v ?? '').trim();
    const s = String(ws[cl + '3']?.v ?? '').trim();
    if (g) currentGroup = g;
    if (!s) continue;
    const cat = mapToCategoryId(currentGroup, s);
    if (cat) out[cl] = { categoryId: cat, group: currentGroup, subcat: s };
    else if (!/^TROŠKOVI$|^ŠTEDNJA$|^KRAJNJE/i.test(currentGroup) && currentGroup !== 'POČETNO STANJE') {
      unmatched.push(`${cl}: ${currentGroup}/${s}`);
    }
  }
  if (unmatched.length) {
    console.warn(`  unmapped columns: ${unmatched.join(', ')}`);
  }
  return out;
}

// --------------------------------- Parsing -----------------------------

/**
 * From a cell with a number (possibly via formula), return the list of
 * additive components. `=1500+800-200` → [1500, 800, -200]. Pure
 * numeric cells return [value]. Formulas with anything other than
 * +/-/digits/dot fall back to the computed value as one entry.
 */
function expandCell(cell) {
  if (!cell) return [];
  if (cell.t !== 'n' || typeof cell.v !== 'number') return [];
  const formula = cell.f;
  if (!formula) return [cell.v];

  const stripped = formula.replace(/^=/, '').replace(/\s/g, '');
  // Pure additive: digits, dots, +, -, leading -
  if (/^-?[\d.]+([+\-][\d.]+)*$/.test(stripped)) {
    return parseAdditive(stripped);
  }
  // Complex formula (multiplication, refs, etc.) — fall back to value.
  return [cell.v];
}

function parseAdditive(s) {
  // Match optional sign then number; first number has implicit +.
  const matches = s.match(/[+\-]?\d+(\.\d+)?/g);
  if (!matches) return [];
  return matches.map(m => parseFloat(m)).filter(n => !isNaN(n) && n !== 0);
}

/** Parse `I (03.01 - 12.01.)` style labels → start date. */
function parseWeekStart(label, fallbackYear) {
  if (!label) return null;
  const m = String(label).match(/(\d{1,2})[.\-](\d{1,2})(?:[.\-](\d{4}))?/);
  if (!m) return null;
  const day = +m[1];
  const month = +m[2] - 1;
  const year = m[3] ? +m[3] : fallbackYear;
  if (!year) return null;
  return new Date(year, month, day);
}

/** Pull a year+month from a block's marker date or first week label. */
function inferBlockMonth(markerCell, weekLabels, sheetYear) {
  // 1. Week labels with explicit YYYY are most authoritative.
  for (const lab of weekLabels) {
    const m = String(lab ?? '').match(/(\d{1,2})[.\-](\d{1,2})[.\-]?(\d{4})/);
    if (m && m[3]) {
      return { year: +m[3], month: +m[2] - 1 };
    }
  }
  // 2. Fall back to the marker date for the MONTH. Override year with
  //    the sheet-name year when present — some Excel sheets have stale
  //    markers copied from the prior year's template (e.g. the 2025
  //    sheet's markers all say 2024, but the data is 2025).
  const d = markerCell?.v;
  if (d instanceof Date) {
    // Use LOCAL date components: the xlsx library converts to a Date
    // in the system timezone, where day-1 markers land on local 00:00
    // even though their UTC equivalent is the prior day's 22:00 / 23:00.
    const year = sheetYear ?? d.getFullYear();
    return { year, month: d.getMonth() };
  }
  return null;
}

/**
 * Year extracted from the sheet name when it contains exactly one
 * 4-digit run. Returns null for multi-year sheets (e.g. " UPISIVANJE
 * 202122.") or template sheets without a year.
 */
function yearFromSheetName(name) {
  const digits = (name.match(/\d/g) ?? []).join('');
  if (digits.length === 4) return +digits;
  return null;
}

// --------------------------------- Walk --------------------------------

const wb = XLSX.readFile(
  path.resolve('docs/Vođenje troškova.xlsx'),
  { cellFormula: true, cellDates: true },
);

const yearSheets = wb.SheetNames.filter(name => /upisivanje/i.test(name.trim()));
console.log(`\nFound ${yearSheets.length} year sheets: ${yearSheets.join(', ')}\n`);

const transactions = [];
const budgetMap = new Map(); // key: `${yyyymm}|${categoryId}` → { amount, sources }
const stats = {
  sheets: 0,
  monthBlocks: 0,
  cells: 0,
  components: 0,
  skippedNoCategory: 0,
};

for (const sheetName of yearSheets) {
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws['!ref']) continue;
  const sheetYear = yearFromSheetName(sheetName);
  console.log(`Processing "${sheetName}"${sheetYear ? ` (year ${sheetYear})` : ' (multi-year)'}`);
  stats.sheets++;

  const colMap = buildColumnMap(ws);
  if (Object.keys(colMap).length === 0) {
    console.warn('  no recognised columns, skipping sheet');
    continue;
  }

  const range = XLSX.utils.decode_range(ws['!ref']);
  let r = 3; // Data starts after the 3 header rows.
  while (r <= range.e.r) {
    const aCell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    // A month-block marker is a Date in column A.
    if (!(aCell?.v instanceof Date)) {
      r++;
      continue;
    }
    // Block layout: marker, Planirano, I, II, III, IV, V, Ostvareno, P-O.
    const weekRows = [r + 2, r + 3, r + 4, r + 5, r + 6];
    const weekLabels = weekRows.map(wr => ws[XLSX.utils.encode_cell({ r: wr, c: 0 })]?.v);
    const month = inferBlockMonth(aCell, weekLabels, sheetYear);
    if (!month) {
      r += 9;
      continue;
    }
    stats.monthBlocks++;

    // --- Budgets: row immediately after the marker is "Planirano". ---
    const planiranoRow = r + 1;
    const yyyymm = `${month.year}-${String(month.month + 1).padStart(2, '0')}`;
    for (const [cl, meta] of Object.entries(colMap)) {
      const cell = ws[cl + (planiranoRow + 1)];
      const components = expandCell(cell);
      if (components.length === 0) continue;
      const total = components.reduce((s, n) => s + n, 0);
      if (total <= 0) continue; // budgets must be positive
      const key = `${yyyymm}|${meta.categoryId}`;
      const prev = budgetMap.get(key);
      if (prev) {
        // Two columns mapped to the same category (e.g. 2025 Q+S both
        // → ostalo-stan). Sum the planned amounts.
        prev.amount += total;
        prev.sources.push(`${sheetName}:${cl}${planiranoRow + 1}`);
      } else {
        budgetMap.set(key, {
          yyyymm,
          categoryId: meta.categoryId,
          amount: total,
          sources: [`${sheetName}:${cl}${planiranoRow + 1}`],
        });
      }
    }

    for (let i = 0; i < weekRows.length; i++) {
      const wr = weekRows[i];
      const label = weekLabels[i];
      let occurredOn = parseWeekStart(label, month.year);
      if (!occurredOn) {
        // Fall back to evenly-spaced days within the month.
        occurredOn = new Date(month.year, month.month, 1 + i * 7);
      }

      for (const [cl, meta] of Object.entries(colMap)) {
        const cell = ws[cl + (wr + 1)]; // sheet addresses are 1-indexed
        const components = expandCell(cell);
        if (components.length === 0) continue;
        stats.cells++;
        for (const amount of components) {
          stats.components++;
          if (amount === 0) continue;
          transactions.push({
            userId: userRecord.uid,
            amount: Math.round(amount),
            currency: 'RSD',
            categoryId: meta.categoryId,
            note: '',
            occurredOn,
            // Stamp source so re-imports can be detected and removed.
            imported: true,
            importSource: `${sheetName}:${cl}${wr + 1}`,
          });
        }
      }

      r = wr; // advance past the row we just processed
    }
    r += 3; // skip Ostvareno + P-O rows + step to next block start
  }
}

// --------------------------------- Summary -----------------------------

const byCategory = {};
const byYear = {};
let netTotal = 0;
for (const t of transactions) {
  byCategory[t.categoryId] = (byCategory[t.categoryId] ?? 0) + 1;
  const y = t.occurredOn.getFullYear();
  byYear[y] = (byYear[y] ?? 0) + 1;
  netTotal += t.amount;
}

const budgets = [...budgetMap.values()];
const budgetMonths = new Set(budgets.map(b => b.yyyymm)).size;
const budgetTotal = budgets.reduce((s, b) => s + b.amount, 0);

console.log('\n========================= Summary ==========================');
console.log(`Sheets processed:      ${stats.sheets}`);
console.log(`Month blocks:          ${stats.monthBlocks}`);
console.log(`Cells with data:       ${stats.cells}`);
if (WIPE_ALL) {
  console.log(`Transactions to wipe:  ${allExistingCount}`);
  if (manuallyLoggedCount > 0) {
    console.log(`  ⚠  includes ${manuallyLoggedCount} manually-logged tx — these will be lost`);
  }
  console.log(`Budget docs to wipe:   ${allExistingBudgetRefs.length}`);
  if (manualBudgetCount > 0) {
    console.log(`  ⚠  includes ${manualBudgetCount} manually-set budgets — these will be lost`);
  }
} else if (CLEAN) {
  console.log(`Imported tx to wipe:   ${existingImportedCount}`);
  console.log(`Imported budgets wipe: ${existingImportedBudgetRefs.length}`);
}
console.log(`Transactions to write: ${transactions.length}`);
console.log(`Budgets to write:      ${budgets.length} (across ${budgetMonths} months)`);
console.log(`Tx net amount (sum):   ${netTotal.toLocaleString('de-DE')} RSD`);
console.log(`Budget total (sum):    ${budgetTotal.toLocaleString('de-DE')} RSD`);
console.log('\nBy year:');
for (const y of Object.keys(byYear).sort()) {
  console.log(`  ${y}: ${byYear[y]}`);
}
console.log('\nBy category:');
for (const k of Object.keys(byCategory).sort()) {
  console.log(`  ${k.padEnd(24)} ${byCategory[k]}`);
}

if (DRY_RUN) {
  console.log('\n--dry-run: nothing written.');
  process.exit(0);
}

// --------------------------------- Confirm + write ---------------------

if (!ASSUME_YES) {
  let action;
  if (WIPE_ALL && (allExistingCount > 0 || allExistingBudgetRefs.length > 0)) {
    action =
      `DELETE ALL ${allExistingCount} transactions (incl. ${manuallyLoggedCount} manual) ` +
      `and ${allExistingBudgetRefs.length} budget docs (incl. ${manualBudgetCount} manual), ` +
      `then write ${transactions.length} tx + ${budgets.length} budgets`;
  } else if (CLEAN && (existingImportedCount > 0 || existingImportedBudgetRefs.length > 0)) {
    action =
      `Delete ${existingImportedCount} prior tx + ${existingImportedBudgetRefs.length} prior budgets, ` +
      `then write ${transactions.length} tx + ${budgets.length} budgets`;
  } else {
    action = `Write ${transactions.length} transactions + ${budgets.length} budgets`;
  }
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(
    `\n${action} to household "${householdName}"? [y/N] `,
  );
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log('Aborted.');
    process.exit(0);
  }
}

const BATCH_SIZE = 450; // leave headroom under the 500 hard cap
const now = FieldValue.serverTimestamp();

// --- Wipe phase ---
// Transactions: --wipe-all deletes every doc; --clean deletes only imported.
const txWipeTargets = WIPE_ALL
  ? (allExistingSnap?.docs.map(d => d.ref) ?? [])
  : (CLEAN ? existingImportedSnap.docs.map(d => d.ref) : []);

// Budgets: same logic, but the doc refs were already collected at fetch time.
const budgetWipeTargets = WIPE_ALL
  ? allExistingBudgetRefs
  : (CLEAN ? existingImportedBudgetRefs : []);

await batchDelete('transactions', txWipeTargets);
await batchDelete('budgets',      budgetWipeTargets);

// --- Write phase ---
await batchWrite('transactions', transactions, t => ({
  ref: txCol.doc(),
  data: {
    userId: t.userId,
    amount: t.amount,
    currency: t.currency,
    categoryId: t.categoryId,
    note: t.note,
    occurredOn: Timestamp.fromDate(t.occurredOn),
    createdAt: now,
    imported: true,
    importedAt: now,
    importSource: t.importSource,
  },
}));

await batchWrite('budgets', budgets, b => ({
  ref: db.collection('households').doc(householdId)
    .collection('budgets').doc(b.yyyymm)
    .collection('categories').doc(b.categoryId),
  data: {
    amount: Math.round(b.amount),
    imported: true,
    importedAt: now,
    importSource: b.sources.join(','),
  },
}));

console.log('\n✓ Done.');

// --- Helpers ---

async function batchDelete(label, refs) {
  if (refs.length === 0) return;
  let done = 0;
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const slice = refs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const ref of slice) batch.delete(ref);
    await batch.commit();
    done += slice.length;
    process.stdout.write(`\rDeleted ${label}: ${done} / ${refs.length}`);
  }
  process.stdout.write('\n');
}

async function batchWrite(label, items, toOp) {
  if (items.length === 0) return;
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const slice = items.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const item of slice) {
      const { ref, data } = toOp(item);
      batch.set(ref, data);
    }
    await batch.commit();
    done += slice.length;
    process.stdout.write(`\rWritten ${label}: ${done} / ${items.length}`);
  }
  process.stdout.write('\n');
}
