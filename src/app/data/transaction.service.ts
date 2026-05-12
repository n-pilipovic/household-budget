import { Injectable, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  Firestore,
  Timestamp,
  addDoc,
  collection,
  collectionData,
  deleteDoc,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from '@angular/fire/firestore';
import { Observable, combineLatest, map, of, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { HouseholdService } from './household.service';

export interface Transaction {
  id: string;
  userId: string;
  amount: number;        // RSD, integer
  currency: 'RSD';
  categoryId: string;
  note: string;
  occurredOn: Timestamp;
  createdAt: Timestamp;
  /** True for an optimistic local write before the server has acked. */
  pending?: boolean;
}

export interface NewTransactionInput {
  amount: number;
  note: string;
  categoryId: string;
  occurredOn?: Date;     // defaults to today
}

const RECENT_LIMIT = 50;

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);

  /**
   * Recent transactions for the current household. Live via onSnapshot
   * with includeMetadataChanges so optimistic local writes show up
   * with pending=true immediately, then re-emit when the server acks.
   */
  private readonly recent$: Observable<Transaction[]> =
    toObservable(this.households.currentHousehold).pipe(
      switchMap(h => {
        if (!h) return of([] as Transaction[]);
        const q = query(
          collection(this.firestore, 'households', h.id, 'transactions'),
          orderBy('createdAt', 'desc'),
          limit(RECENT_LIMIT),
        );
        // collectionData emits metadata-changes too when configured.
        return (collectionData(q, { idField: 'id' }) as Observable<Transaction[]>);
      }),
    );

  readonly recent = toSignal(this.recent$, { initialValue: [] as Transaction[] });

  /**
   * Transactions for the current month, used by the "This month so
   * far" card on the Today screen. Returns up to 200 docs (more than
   * a 2-user household will plausibly log in a month).
   */
  private readonly thisMonth$: Observable<Transaction[]> =
    toObservable(this.households.currentHousehold).pipe(
      switchMap(h => {
        if (!h) return of([] as Transaction[]);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const q = query(
          collection(this.firestore, 'households', h.id, 'transactions'),
          where('occurredOn', '>=', Timestamp.fromDate(monthStart)),
          where('occurredOn', '<', Timestamp.fromDate(nextMonth)),
          orderBy('occurredOn', 'desc'),
          limit(200),
        );
        return collectionData(q, { idField: 'id' }) as Observable<Transaction[]>;
      }),
    );

  readonly thisMonth = toSignal(this.thisMonth$, { initialValue: [] as Transaction[] });
  readonly thisMonthTotal = computed(() =>
    this.thisMonth().reduce((sum, t) => sum + (t.amount || 0), 0),
  );

  async addTransaction(input: NewTransactionInput): Promise<string> {
    const u = this.auth.user();
    const h = this.households.currentHousehold();
    if (!u) throw new Error('Not authenticated');
    if (!h) throw new Error('No household selected');
    if (!Number.isFinite(input.amount) || input.amount === 0) {
      throw new Error('Amount must be a non-zero number');
    }
    if (!input.categoryId) throw new Error('Category is required');

    const occurredOn = input.occurredOn ?? new Date();
    const ref = await addDoc(
      collection(this.firestore, 'households', h.id, 'transactions'),
      {
        userId: u.uid,
        amount: Math.round(input.amount),
        currency: 'RSD',
        categoryId: input.categoryId,
        note: input.note.trim(),
        occurredOn: Timestamp.fromDate(occurredOn),
        createdAt: serverTimestamp(),
      },
    );
    return ref.id;
  }

  async updateTransaction(
    id: string,
    patch: Partial<NewTransactionInput>,
  ): Promise<void> {
    const h = this.households.currentHousehold();
    if (!h) throw new Error('No household selected');
    if (!id) throw new Error('Transaction id is required');

    const update: Record<string, unknown> = {};
    if (patch.amount !== undefined) {
      if (!Number.isFinite(patch.amount) || patch.amount === 0) {
        throw new Error('Amount must be a non-zero number');
      }
      update['amount'] = Math.round(patch.amount);
    }
    if (patch.note !== undefined) update['note'] = patch.note.trim();
    if (patch.categoryId !== undefined) {
      if (!patch.categoryId) throw new Error('Category is required');
      update['categoryId'] = patch.categoryId;
    }
    if (patch.occurredOn !== undefined) {
      update['occurredOn'] = Timestamp.fromDate(patch.occurredOn);
    }
    if (Object.keys(update).length === 0) return;

    const ref = doc(this.firestore, 'households', h.id, 'transactions', id);
    await updateDoc(ref, update);
  }

  async deleteTransaction(id: string): Promise<void> {
    const h = this.households.currentHousehold();
    if (!h) throw new Error('No household selected');
    if (!id) throw new Error('Transaction id is required');
    const ref = doc(this.firestore, 'households', h.id, 'transactions', id);
    await deleteDoc(ref);
  }
}
