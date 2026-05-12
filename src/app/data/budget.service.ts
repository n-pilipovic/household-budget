import { Injectable, Signal, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  Firestore,
  Timestamp,
  collection,
  collectionData,
  deleteDoc,
  deleteField,
  doc,
  docData,
  serverTimestamp,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, combineLatest, of, switchMap } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthService } from '../auth/auth.service';
import { HouseholdService } from './household.service';

export interface BudgetEntry {
  categoryId: string;     // = doc id, but also denormalised for type clarity
  amount: number;
}

/** Top-level metadata on the budgets/{yyyymm} doc itself. */
export interface MonthMeta {
  startingAmount?: number;   // cash available for the month (income inflow)
  updatedAt?: Timestamp;
  updatedBy?: string;        // uid of the member who set it
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
  private readonly auth = inject(AuthService);

  /**
   * Live month metadata (currently: the starting amount when income
   * for the month arrives — usually around the 5th, give or take).
   * Returns null when the doc doesn't exist yet.
   */
  monthMetaFor(month: Signal<MonthKey>): Signal<MonthMeta | null> {
    const obs: Observable<MonthMeta | null> =
      combineLatest([
        toObservable(this.households.currentHousehold),
        toObservable(month),
      ]).pipe(
        switchMap(([h, m]) => {
          if (!h) return of(null);
          const ref = doc(this.firestore, 'households', h.id, 'budgets', m);
          return (docData(ref) as Observable<MonthMeta | undefined>)
            .pipe(map(data => (data && Object.keys(data).length > 0) ? data : null));
        }),
      );
    return toSignal(obs, { initialValue: null as MonthMeta | null });
  }

  /**
   * Set (or clear, with amount <= 0) the starting amount for a given
   * month. Stamps updatedAt + updatedBy so the household can see who
   * set it.
   */
  async setMonthStartingAmount(month: MonthKey, amount: number): Promise<void> {
    const h = this.households.currentHousehold();
    const u = this.auth.user();
    if (!h) throw new Error('No household selected');
    if (!u) throw new Error('Not authenticated');
    if (!month) throw new Error('Month is required');

    const ref = doc(this.firestore, 'households', h.id, 'budgets', month);
    if (!Number.isFinite(amount) || amount <= 0) {
      // Clear field. setDoc + merge tolerates the doc not existing.
      await setDoc(ref, { startingAmount: deleteField() }, { merge: true });
      return;
    }
    await setDoc(
      ref,
      {
        startingAmount: Math.round(amount),
        updatedAt: serverTimestamp(),
        updatedBy: u.uid,
      },
      { merge: true },
    );
  }

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
