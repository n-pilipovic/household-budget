import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  limit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of, switchMap } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { CategoryService, Category, CategoryGroup } from '../../data/category.service';
import { HouseholdService } from '../../data/household.service';
import { BudgetService, monthKey } from '../../data/budget.service';
import { Transaction } from '../../data/transaction.service';

interface MonthSelection {
  year: number;
  month: number; // 0-indexed
}

export interface SubRow {
  category: Category;
  actual: number;
  transactions: Transaction[];
}

export interface GroupRow {
  group: CategoryGroup;
  planned: number;       // 0 if no budget set for this group this month
  actual: number;        // sum of transactions across all sub-categories
  variance: number;      // planned - actual; meaningful only when planned > 0
  variancePct: number;   // actual / planned (capped at 1.1 for the bar fill)
  state: 'no-budget' | 'good' | 'watch' | 'bad';
  subRows: SubRow[];
  transactionCount: number;
}

@Component({
  selector: 'app-monthly',
  imports: [RouterLink],
  templateUrl: './monthly.page.html',
})
export class MonthlyPage {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);
  private readonly categories = inject(CategoryService);
  private readonly budgets = inject(BudgetService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly household = this.households.currentHousehold;
  protected readonly memberProfiles = this.households.memberProfiles;

  // Month state — defaults to the current calendar month.
  protected readonly selectedMonth = signal<MonthSelection>(currentMonth());
  protected readonly monthKey = computed(() =>
    monthKey(this.selectedMonth().year, this.selectedMonth().month),
  );
  protected readonly monthLabel = computed(() => {
    const m = this.selectedMonth();
    return new Date(m.year, m.month, 1).toLocaleString('en-GB', {
      month: 'long', year: 'numeric',
    });
  });
  protected readonly isCurrentMonth = computed(() => {
    const m = this.selectedMonth();
    const now = new Date();
    return m.year === now.getFullYear() && m.month === now.getMonth();
  });
  protected readonly daysInMonth = computed(() =>
    new Date(this.selectedMonth().year, this.selectedMonth().month + 1, 0).getDate(),
  );
  protected readonly daysRemaining = computed(() => {
    if (!this.isCurrentMonth()) return 0;
    return this.daysInMonth() - new Date().getDate();
  });

  // Live transactions for the selected month.
  private readonly transactionsForMonth$: Observable<Transaction[]> =
    combineLatest([
      toObservable(this.households.currentHousehold),
      toObservable(this.selectedMonth),
    ]).pipe(
      switchMap(([h, m]) => {
        if (!h) return of([] as Transaction[]);
        const start = new Date(m.year, m.month, 1);
        const end = new Date(m.year, m.month + 1, 1);
        const q = query(
          collection(this.firestore, 'households', h.id, 'transactions'),
          where('occurredOn', '>=', Timestamp.fromDate(start)),
          where('occurredOn', '<', Timestamp.fromDate(end)),
          orderBy('occurredOn', 'desc'),
          limit(500),
        );
        return collectionData(q, { idField: 'id' }) as Observable<Transaction[]>;
      }),
    );

  protected readonly monthTransactions = toSignal(this.transactionsForMonth$, {
    initialValue: [] as Transaction[],
  });

  // Budgets for the selected month (signal-driven for live month switching).
  protected readonly monthBudgets = this.budgets.budgetsForMonth(this.monthKey);

  // Top-level month metadata: starting amount (cash for the month).
  protected readonly monthMeta = this.budgets.monthMetaFor(this.monthKey);
  protected readonly startingAmount = computed(() => this.monthMeta()?.startingAmount ?? 0);
  protected readonly hasStartingAmount = computed(() => this.startingAmount() > 0);
  protected readonly remaining = computed(() => this.startingAmount() - this.totalActual());
  protected readonly startingPct = computed(() => {
    const s = this.startingAmount();
    if (s <= 0) return 0;
    return Math.min(this.totalActual() / s, 1);
  });

  /** Pace based on starting-amount cash flow, not category planned sum. */
  protected readonly startingState = computed<GroupRow['state']>(() => {
    const start = this.startingAmount();
    if (start <= 0) return 'no-budget';
    const spent = this.totalActual();
    if (spent > start) return 'bad';
    const spentRatio = spent / start;
    const timeRatio = this.isCurrentMonth()
      ? new Date().getDate() / this.daysInMonth()
      : 1;
    if (spentRatio > timeRatio + 0.1) return 'watch';
    return 'good';
  });

  /** Per-group aggregation. One row per top-level group, in sort order.
   *  Sub-categories are nested under each row for breakdown. */
  protected readonly rows = computed<GroupRow[]>(() => {
    const groups = this.categories.groups();
    const txs = this.monthTransactions();
    const budgetMap = this.monthBudgets();

    const actualByCat = new Map<string, number>();
    const txsByCat = new Map<string, Transaction[]>();
    for (const t of txs) {
      actualByCat.set(t.categoryId, (actualByCat.get(t.categoryId) ?? 0) + (t.amount || 0));
      const list = txsByCat.get(t.categoryId) ?? [];
      list.push(t);
      txsByCat.set(t.categoryId, list);
    }

    return groups.map(g => {
      const subRows: SubRow[] = g.categories.map(c => ({
        category: c,
        actual: actualByCat.get(c.id) ?? 0,
        transactions: txsByCat.get(c.id) ?? [],
      }));
      const actual = subRows.reduce((s, sr) => s + sr.actual, 0);
      const planned = budgetMap.get(g.slug) ?? 0;
      const variance = planned - actual;
      const variancePct = planned > 0 ? Math.min(actual / planned, 1.1) : 0;
      let state: GroupRow['state'];
      if (planned === 0) state = actual > 0 ? 'bad' : 'no-budget';
      else if (variance >= 0 && actual / planned <= 0.9) state = 'good';
      else if (variance >= 0) state = 'watch';
      else state = 'bad';

      return {
        group: g,
        planned,
        actual,
        variance,
        variancePct,
        state,
        subRows,
        transactionCount: subRows.reduce((s, sr) => s + sr.transactions.length, 0),
      };
    });
  });

  protected readonly totalPlanned = computed(() =>
    this.rows().reduce((s, r) => s + r.planned, 0),
  );
  protected readonly totalActual = computed(() =>
    this.rows().reduce((s, r) => s + r.actual, 0),
  );
  protected readonly totalVariance = computed(() => this.totalPlanned() - this.totalActual());
  protected readonly totalPct = computed(() => {
    const p = this.totalPlanned();
    if (p === 0) return 0;
    return Math.min(this.totalActual() / p, 1.1);
  });
  protected readonly totalState = computed<GroupRow['state']>(() => {
    const planned = this.totalPlanned();
    const actual = this.totalActual();
    if (planned === 0) return actual > 0 ? 'bad' : 'no-budget';
    const variance = planned - actual;
    if (variance >= 0 && actual / planned <= 0.9) return 'good';
    if (variance >= 0) return 'watch';
    return 'bad';
  });

  // Expansion + inline editing state
  protected readonly expandedId = signal<string | null>(null);
  protected readonly editingBudgetId = signal<string | null>(null);
  protected readonly budgetDraft = signal('');
  protected readonly budgetBusy = signal(false);
  protected readonly budgetError = signal<string | null>(null);

  // Inline editor state for the starting-amount header field.
  protected readonly editingStarting = signal(false);
  protected readonly startingDraft = signal('');
  protected readonly startingBusy = signal(false);
  protected readonly startingError = signal<string | null>(null);

  prevMonth() {
    this.selectedMonth.update(m => {
      const d = new Date(m.year, m.month - 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    this.expandedId.set(null);
    this.cancelBudgetEdit();
  }

  nextMonth() {
    this.selectedMonth.update(m => {
      const d = new Date(m.year, m.month + 1, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
    this.expandedId.set(null);
    this.cancelBudgetEdit();
  }

  goToCurrentMonth() {
    this.selectedMonth.set(currentMonth());
    this.expandedId.set(null);
    this.cancelBudgetEdit();
  }

  toggleExpand(groupSlug: string) {
    this.expandedId.update(cur => (cur === groupSlug ? null : groupSlug));
    if (this.editingBudgetId() !== null && this.editingBudgetId() !== groupSlug) {
      this.cancelBudgetEdit();
    }
  }

  startBudgetEdit(row: GroupRow) {
    this.editingBudgetId.set(row.group.slug);
    this.budgetDraft.set(row.planned > 0 ? String(row.planned) : '');
    this.budgetError.set(null);
    this.expandedId.set(row.group.slug);
  }

  cancelBudgetEdit() {
    this.editingBudgetId.set(null);
    this.budgetDraft.set('');
    this.budgetError.set(null);
  }

  async saveBudget(groupSlug: string) {
    if (this.budgetBusy()) return;
    const raw = this.budgetDraft().trim();
    const cleaned = raw.replace(/[.,]/g, '');
    const amount = cleaned === '' ? 0 : parseInt(cleaned, 10);
    if (!Number.isFinite(amount) || amount < 0) {
      this.budgetError.set('Enter a positive number, or leave empty to clear.');
      return;
    }
    this.budgetBusy.set(true);
    this.budgetError.set(null);
    try {
      await this.budgets.setBudget(this.monthKey(), groupSlug, amount);
      this.cancelBudgetEdit();
    } catch (err) {
      console.error('setBudget failed', err);
      this.budgetError.set(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      this.budgetBusy.set(false);
    }
  }

  // ---------- Starting amount editor ----------

  startStartingEdit() {
    this.startingError.set(null);
    this.startingDraft.set(this.startingAmount() > 0 ? String(this.startingAmount()) : '');
    this.editingStarting.set(true);
  }

  cancelStartingEdit() {
    this.editingStarting.set(false);
    this.startingDraft.set('');
    this.startingError.set(null);
  }

  async saveStartingAmount(e: SubmitEvent) {
    e.preventDefault();
    if (this.startingBusy()) return;
    const cleaned = this.startingDraft().trim().replace(/[.,]/g, '');
    const amount = cleaned === '' ? 0 : parseInt(cleaned, 10);
    if (!Number.isFinite(amount) || amount < 0) {
      this.startingError.set('Enter a positive number, or leave empty to clear.');
      return;
    }
    this.startingBusy.set(true);
    this.startingError.set(null);
    try {
      await this.budgets.setMonthStartingAmount(this.monthKey(), amount);
      this.cancelStartingEdit();
    } catch (err) {
      console.error('setMonthStartingAmount failed', err);
      this.startingError.set(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      this.startingBusy.set(false);
    }
  }

  async clearStartingAmount() {
    if (this.startingBusy()) return;
    if (!window.confirm('Clear this month’s available amount?')) return;
    this.startingBusy.set(true);
    try {
      await this.budgets.setMonthStartingAmount(this.monthKey(), 0);
      this.cancelStartingEdit();
    } catch (err) {
      console.error('setMonthStartingAmount (clear) failed', err);
      this.startingError.set(err instanceof Error ? err.message : 'Could not clear.');
    } finally {
      this.startingBusy.set(false);
    }
  }

  // ---------- Category budget editor ----------

  async clearBudget(groupSlug: string) {
    if (this.budgetBusy()) return;
    if (!window.confirm('Clear the planned amount for this group?')) return;
    this.budgetBusy.set(true);
    try {
      await this.budgets.setBudget(this.monthKey(), groupSlug, 0);
      this.cancelBudgetEdit();
    } catch (err) {
      console.error('setBudget (clear) failed', err);
      this.budgetError.set(err instanceof Error ? err.message : 'Could not clear.');
    } finally {
      this.budgetBusy.set(false);
    }
  }

  // ---------- helpers used by the template ----------

  formatAmount(n: number): string {
    return n.toLocaleString('de-DE');
  }

  /** Signed string like "-1.500" or "+2.890". */
  formatSigned(n: number): string {
    if (n === 0) return '0';
    const sign = n > 0 ? '−' : '+';  // green if positive (under budget); red if negative
    return `${sign}${this.formatAmount(Math.abs(n))}`;
  }

  initialFor(t: Transaction): string {
    const u = this.user();
    if (u && t.userId === u.uid) {
      return (u.displayName?.[0] ?? u.email?.[0] ?? '?').toUpperCase();
    }
    const p = this.memberProfiles().get(t.userId);
    return ((p?.displayName?.[0] ?? p?.email?.[0]) ?? '?').toUpperCase();
  }

  colorSlotFor(uid: string): '1' | '2' {
    const h = this.household();
    return (h?.memberColors?.[uid] as '1' | '2' | undefined) ?? '1';
  }

  formatDay(ts: { toDate(): Date } | undefined): string {
    if (!ts) return '';
    const d = ts.toDate();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  goHome() {
    this.router.navigateByUrl('/today');
  }
}

function currentMonth(): MonthSelection {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}
