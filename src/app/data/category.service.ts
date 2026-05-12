import { Injectable, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  Firestore,
  collection,
  collectionData,
  orderBy,
  query,
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { HouseholdService } from './household.service';

export interface Category {
  id: string;
  group: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  active: boolean;
}

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private readonly firestore = inject(Firestore);
  private readonly households = inject(HouseholdService);

  private readonly categories$: Observable<Category[]> =
    toObservable(this.households.currentHousehold).pipe(
      switchMap(h => {
        if (!h) return of([] as Category[]);
        const q = query(
          collection(this.firestore, 'households', h.id, 'categories'),
          orderBy('sortOrder', 'asc'),
        );
        return collectionData(q, { idField: 'id' }) as Observable<Category[]>;
      }),
    );

  readonly categories = toSignal(this.categories$, { initialValue: [] as Category[] });
  readonly byId = computed<Record<string, Category>>(() => {
    const out: Record<string, Category> = {};
    for (const c of this.categories()) out[c.id] = c;
    return out;
  });
  readonly activeCategories = computed(() => this.categories().filter(c => c.active));
}
