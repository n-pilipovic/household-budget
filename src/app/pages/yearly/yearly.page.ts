import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  doc,
  getDoc,
  limit,
  orderBy,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, from, of, switchMap } from 'rxjs';
import { CategoryService } from '../../data/category.service';
import { HouseholdService } from '../../data/household.service';
import { Transaction } from '../../data/transaction.service';
import { MonthMeta, monthKey } from '../../data/budget.service';

interface MonthRow {
  index: number;          // 0-11
  key: string;            // YYYY-MM
  label: string;          // 'Jan', 'Feb', …
  earned: number;
  spent: number;
  net: number;            // earned - spent
}

interface GroupRow {
  slug: string;
  name: string;
  total: number;
}

@Component({
  selector: 'app-yearly',
  imports: [],
  templateUrl: './yearly.page.html',
})
export class YearlyPage {
  private readonly firestore = inject(Firestore);
  private readonly households = inject(HouseholdService);
  private readonly categories = inject(CategoryService);
  private readonly router = inject(Router);

  protected readonly household = this.households.currentHousehold;

  // Year selection (defaults to current calendar year).
  protected readonly selectedYear = signal<number>(new Date().getFullYear());
  protected readonly isCurrentYear = computed(() =>
    this.selectedYear() === new Date().getFullYear(),
  );

  // Live transactions for the selected year.
  private readonly yearTxs$: Observable<Transaction[]> =
    combineLatest([
      toObservable(this.household),
      toObservable(this.selectedYear),
    ]).pipe(
      switchMap(([h, y]) => {
        if (!h) return of([] as Transaction[]);
        const start = new Date(y, 0, 1);
        const end = new Date(y + 1, 0, 1);
        const q = query(
          collection(this.firestore, 'households', h.id, 'transactions'),
          where('occurredOn', '>=', Timestamp.fromDate(start)),
          where('occurredOn', '<', Timestamp.fromDate(end)),
          orderBy('occurredOn', 'desc'),
          limit(5000),
        );
        return collectionData(q, { idField: 'id' }) as Observable<Transaction[]>;
      }),
    );

  protected readonly yearTxs = toSignal(this.yearTxs$, {
    initialValue: [] as Transaction[],
  });

  // Per-month metadata (startingAmount): one getDoc per month, then map.
  private readonly yearMeta$: Observable<Record<string, MonthMeta>> =
    combineLatest([
      toObservable(this.household),
      toObservable(this.selectedYear),
    ]).pipe(
      switchMap(([h, y]) => {
        if (!h) return of({} as Record<string, MonthMeta>);
        const reads = Array.from({ length: 12 }, (_, i) => {
          const key = monthKey(y, i);
          return getDoc(doc(this.firestore, 'households', h.id, 'budgets', key))
            .then(snap => [key, snap.exists() ? (snap.data() as MonthMeta) : null] as const)
            .catch(() => [key, null] as const);
        });
        return from(Promise.all(reads).then(entries => {
          const out: Record<string, MonthMeta> = {};
          for (const [k, v] of entries) if (v) out[k] = v;
          return out;
        }));
      }),
    );

  protected readonly yearMeta = toSignal(this.yearMeta$, {
    initialValue: {} as Record<string, MonthMeta>,
  });

  // ---------- KPIs ----------

  protected readonly totalSpent = computed(() =>
    this.yearTxs().reduce((s, t) => s + (t.amount || 0), 0),
  );

  protected readonly totalEarned = computed(() => {
    let sum = 0;
    for (const m of Object.values(this.yearMeta())) {
      sum += m.startingAmount ?? 0;
    }
    return sum;
  });

  protected readonly netResult = computed(() => this.totalEarned() - this.totalSpent());

  protected readonly transactionCount = computed(() => this.yearTxs().length);

  // ---------- Monthly breakdown ----------

  protected readonly monthly = computed<MonthRow[]>(() => {
    const txs = this.yearTxs();
    const meta = this.yearMeta();
    const year = this.selectedYear();

    // Bucket transactions by month for O(N) aggregation.
    const spentByMonth = new Map<number, number>();
    for (const t of txs) {
      const d = t.occurredOn?.toDate();
      if (!d || d.getFullYear() !== year) continue;
      const m = d.getMonth();
      spentByMonth.set(m, (spentByMonth.get(m) ?? 0) + (t.amount || 0));
    }

    return Array.from({ length: 12 }, (_, i) => {
      const key = monthKey(year, i);
      const earned = meta[key]?.startingAmount ?? 0;
      const spent = spentByMonth.get(i) ?? 0;
      const label = new Date(year, i, 1).toLocaleString('en-GB', { month: 'short' });
      return { index: i, key, label, earned, spent, net: earned - spent };
    });
  });

  /** Max value across earned + spent in any month, used to scale bars. */
  protected readonly monthlyMax = computed(() => {
    let max = 0;
    for (const m of this.monthly()) {
      if (m.earned > max) max = m.earned;
      if (m.spent > max) max = m.spent;
    }
    return Math.max(1, max);
  });

  // ---------- By-group breakdown ----------

  protected readonly groupBreakdown = computed<GroupRow[]>(() => {
    const slugByCat = this.categories.groupSlugByCategoryId();
    const groupNameBySlug: Record<string, string> = {};
    for (const c of this.categories.activeCategories()) {
      const slug = slugByCat[c.id];
      if (slug && !groupNameBySlug[slug]) groupNameBySlug[slug] = c.group;
    }

    const sums = new Map<string, number>();
    for (const t of this.yearTxs()) {
      const slug = slugByCat[t.categoryId];
      if (!slug) continue;
      sums.set(slug, (sums.get(slug) ?? 0) + (t.amount || 0));
    }
    return [...sums.entries()]
      .map(([slug, total]) => ({ slug, name: groupNameBySlug[slug] ?? slug, total }))
      .sort((a, b) => b.total - a.total);
  });

  /** Largest group sum, for the inline bar in the by-group list. */
  protected readonly maxGroupTotal = computed(() => {
    let max = 0;
    for (const g of this.groupBreakdown()) if (g.total > max) max = g.total;
    return Math.max(1, max);
  });

  // ---------- Navigation ----------

  prevYear() {
    this.selectedYear.update(y => y - 1);
  }

  nextYear() {
    this.selectedYear.update(y => y + 1);
  }

  goToCurrentYear() {
    this.selectedYear.set(new Date().getFullYear());
  }

  back() {
    this.router.navigateByUrl('/today');
  }

  // ---------- Helpers ----------

  formatAmount(n: number): string {
    return n.toLocaleString('de-DE');
  }

  formatSigned(n: number): string {
    if (n === 0) return '0';
    return (n > 0 ? '+' : '−') + this.formatAmount(Math.abs(n));
  }

  pct(value: number, max: number): number {
    if (max <= 0) return 0;
    return Math.min(value / max, 1) * 100;
  }
}
