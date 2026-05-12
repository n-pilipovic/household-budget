import { Injectable, Signal, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  Firestore,
  collection,
  collectionData,
  deleteDoc,
  doc,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of, switchMap } from 'rxjs';
import { map } from 'rxjs/operators';
import { HouseholdService } from './household.service';

export interface BudgetEntry {
  categoryId: string;     // = doc id, but also denormalised for type clarity
  amount: number;
}

/** A year/month key in YYYY-MM form, e.g. '2026-05'. */
export type MonthKey = string;

export function monthKey(year: number, monthZeroIndexed: number): MonthKey {
  const m = String(monthZeroIndexed + 1).padStart(2, '0');
  return `${year}-${m}`;
}

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private readonly firestore = inject(Firestore);
  private readonly households = inject(HouseholdService);

  /**
   * Live budgets for a given month, keyed by categoryId.
   * Pass a Signal so the result updates when the calling component
   * navigates between months.
   */
  budgetsForMonth(month: Signal<MonthKey>): Signal<Map<string, number>> {
    const obs: Observable<Map<string, number>> =
      combineLatest([
        toObservable(this.households.currentHousehold),
        toObservable(month),
      ]).pipe(
        switchMap(([h, m]) => {
          if (!h) return of(new Map<string, number>());
          const col = collection(
            this.firestore, 'households', h.id, 'budgets', m, 'categories',
          );
          return (collectionData(col, { idField: 'id' }) as Observable<{ id: string; amount: number }[]>)
            .pipe(map(docs => {
              const out = new Map<string, number>();
              for (const d of docs) out.set(d.id, d.amount ?? 0);
              return out;
            }));
        }),
      );
    return toSignal(obs, { initialValue: new Map<string, number>() });
  }

  /**
   * Set the planned amount for a category in a given month. Passing
   * 0 deletes the doc to keep the collection tidy.
   */
  async setBudget(month: MonthKey, categoryId: string, amount: number): Promise<void> {
    const h = this.households.currentHousehold();
    if (!h) throw new Error('No household selected');
    if (!month || !categoryId) throw new Error('Month and category are required');

    const ref = doc(
      this.firestore, 'households', h.id, 'budgets', month, 'categories', categoryId,
    );
    if (!Number.isFinite(amount) || amount <= 0) {
      try {
        await deleteDoc(ref);
      } catch {
        // Tolerate "no such document" — we wanted it gone anyway.
      }
      return;
    }
    await setDoc(ref, { amount: Math.round(amount) });
  }
}
