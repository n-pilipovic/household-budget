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
import { CategoryService, Category } from '../../data/category.service';
import { HouseholdService } from '../../data/household.service';
import { BudgetService, monthKey } from '../../data/budget.service';
import { Transaction } from '../../data/transaction.service';

interface MonthSelection {
  year: number;
  month: number; // 0-indexed
}

export interface CategoryRow {
  category: Category;
  planned: number;       // 0 if no budget set
  actual: number;        // sum of transactions in this category for the month
  variance: number;      // planned - actual; meaningful only when planned > 0
  variancePct: number;   // actual / planned (capped at 1.1 for the progress bar fill)
  state: 'no-budget' | 'good' | 'watch' | 'bad';
  transactions: Transaction[];
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

  /** Per-category aggregation. One row per active category, in sort order. */
  protected readonly rows = computed<CategoryRow[]>(() => {
    const cats = this.categories.activeCategories();
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

    return cats.map(cat => {
      const planned = budgetMap.get(cat.id) ?? 0;
      const actual = actualByCat.get(cat.id) ?? 0;
      const variance = planned - actual;
      const variancePct = planned > 0 ? Math.min(actual / planned, 1.1) : 0;
      let state: CategoryRow['state'];
      if (planned === 0) state = actual > 0 ? 'bad' : 'no-budget';
      else if (variance >= 0 && actual / planned <= 0.9) state = 'good';
      else if (variance >= 0) state = 'watch';
      else state = 'bad';

      return {
        category: cat,
        planned,
        actual,
        variance,
        variancePct,
        state,
        transactions: txsByCat.get(cat.id) ?? [],
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
  protected readonly totalState = computed<CategoryRow['state']>(() => {
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

  toggleExpand(catId: string) {
    this.expandedId.update(cur => (cur === catId ? null : catId));
    if (this.editingBudgetId() !== null && this.editingBudgetId() !== catId) {
      this.cancelBudgetEdit();
    }
  }

  startBudgetEdit(row: CategoryRow) {
    this.editingBudgetId.set(row.category.id);
    this.budgetDraft.set(row.planned > 0 ? String(row.planned) : '');
    this.budgetError.set(null);
    this.expandedId.set(row.category.id);
  }

  cancelBudgetEdit() {
    this.editingBudgetId.set(null);
    this.budgetDraft.set('');
    this.budgetError.set(null);
  }

  async saveBudget(catId: string) {
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
      await this.budgets.setBudget(this.monthKey(), catId, amount);
      this.cancelBudgetEdit();
    } catch (err) {
      console.error('setBudget failed', err);
      this.budgetError.set(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      this.budgetBusy.set(false);
    }
  }

  async clearBudget(catId: string) {
    if (this.budgetBusy()) return;
    if (!window.confirm('Clear the planned amount for this category?')) return;
    this.budgetBusy.set(true);
    try {
      await this.budgets.setBudget(this.monthKey(), catId, 0);
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
