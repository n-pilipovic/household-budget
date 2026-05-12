import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
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
import { CategoryService } from '../../data/category.service';
import { HouseholdService } from '../../data/household.service';
import { Transaction } from '../../data/transaction.service';
import { monthKey } from '../../data/budget.service';

type FilterId = 'all' | 'this-month' | 'last-30';

interface MonthBucket {
  key: string;            // YYYY-MM
  year: number;
  month: number;          // 0-indexed
  label: string;          // 'Jan', 'Feb', etc.
  actual: number;
  isCurrent: boolean;
  fillPct: number;        // 0..1, scaled to the max actual across all 12 months
}

@Component({
  selector: 'app-category-detail',
  imports: [],
  templateUrl: './category-detail.page.html',
})
export class CategoryDetailPage {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);
  private readonly categories = inject(CategoryService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly household = this.households.currentHousehold;
  protected readonly memberProfiles = this.households.memberProfiles;

  protected readonly categoryId = signal<string | null>(
    this.route.snapshot.paramMap.get('id'),
  );

  protected readonly category = computed(() => {
    const id = this.categoryId();
    if (!id) return null;
    return this.categories.byId()[id] ?? null;
  });

  // The 12-month window: [start, end). end is the 1st of the month
  // AFTER the current one so the current month is included.
  private readonly window = computed(() => {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  });

  /** Twelve buckets, oldest → newest, regardless of whether they have data. */
  private readonly monthList = computed<{ year: number; month: number; key: string; label: string }[]>(() => {
    const { start } = this.window();
    const out: { year: number; month: number; key: string; label: string }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      out.push({
        year: d.getFullYear(),
        month: d.getMonth(),
        key: monthKey(d.getFullYear(), d.getMonth()),
        label: d.toLocaleString('en-GB', { month: 'short' }),
      });
    }
    return out;
  });

  /** Live transactions for this category over the past 12 months. */
  private readonly transactions12mo$: Observable<Transaction[]> =
    combineLatest([
      toObservable(this.household),
      toObservable(this.categoryId),
    ]).pipe(
      switchMap(([h, catId]) => {
        if (!h || !catId) return of([] as Transaction[]);
        const { start, end } = this.window();
        const q = query(
          collection(this.firestore, 'households', h.id, 'transactions'),
          where('categoryId', '==', catId),
          where('occurredOn', '>=', Timestamp.fromDate(start)),
          where('occurredOn', '<', Timestamp.fromDate(end)),
          orderBy('occurredOn', 'desc'),
          limit(500),
        );
        return collectionData(q, { idField: 'id' }) as Observable<Transaction[]>;
      }),
    );

  protected readonly transactions12mo = toSignal(this.transactions12mo$, {
    initialValue: [] as Transaction[],
  });

  /** 12 buckets of actual, ready to render as bars.
   *  Budgets are now group-level (not per-category), so this view
   *  shows actual spending only. The bar heights scale to the max
   *  actual across the 12 months so trends pop. */
  protected readonly monthly = computed<MonthBucket[]>(() => {
    const months = this.monthList();
    const txs = this.transactions12mo();
    const now = new Date();

    const actualByKey = new Map<string, number>();
    for (const t of txs) {
      const d = t.occurredOn?.toDate();
      if (!d) continue;
      const key = monthKey(d.getFullYear(), d.getMonth());
      actualByKey.set(key, (actualByKey.get(key) ?? 0) + (t.amount || 0));
    }

    const buckets: MonthBucket[] = months.map(m => {
      const actual = actualByKey.get(m.key) ?? 0;
      const isCurrent = m.year === now.getFullYear() && m.month === now.getMonth();
      return { ...m, actual, isCurrent, fillPct: 0 };
    });

    const maxVal = Math.max(1, ...buckets.map(b => b.actual));
    for (const b of buckets) b.fillPct = b.actual / maxVal;
    return buckets;
  });

  // ---------- KPI stats ----------

  protected readonly total12mo = computed(() =>
    this.transactions12mo().reduce((s, t) => s + (t.amount || 0), 0),
  );
  protected readonly avgPerMonth = computed(() => Math.round(this.total12mo() / 12));
  protected readonly avgPerWeek = computed(() => Math.round(this.total12mo() / 52));
  protected readonly thisMonthActual = computed(() => {
    const m = this.monthly().find(b => b.isCurrent);
    return m?.actual ?? 0;
  });
  protected readonly transactionCount = computed(() => this.transactions12mo().length);

  // ---------- Filter chips ----------

  protected readonly filter = signal<FilterId>('all');

  protected readonly filteredTransactions = computed(() => {
    const all = this.transactions12mo();
    switch (this.filter()) {
      case 'this-month': {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return all.filter(t => {
          const d = t.occurredOn?.toDate();
          return d && d >= start && d < end;
        });
      }
      case 'last-30': {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        return all.filter(t => (t.occurredOn?.toDate() ?? new Date(0)) >= cutoff);
      }
      case 'all':
      default:
        return all;
    }
  });

  setFilter(f: FilterId) {
    this.filter.set(f);
  }

  // ---------- helpers ----------

  formatAmount(n: number): string {
    return n.toLocaleString('de-DE');
  }

  formatDay(ts: { toDate(): Date } | undefined): string {
    if (!ts) return '';
    const d = ts.toDate();
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
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

  back() {
    this.router.navigateByUrl('/monthly');
  }
}
