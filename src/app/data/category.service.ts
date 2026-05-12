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
import { groupSlug } from './budget.service';

export interface Category {
  id: string;
  group: string;
  name: string;
  icon: string | null;
  sortOrder: number;
  active: boolean;
}

/** A top-level category group with its constituent sub-categories. */
export interface CategoryGroup {
  slug: string;       // doc-id form, e.g. 'hrana'
  name: string;       // display, e.g. 'HRANA'
  sortOrder: number;  // lowest sortOrder amongst the group's categories
  categories: Category[];
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

  /**
   * Active categories collapsed into their parent groups, preserving
   * sub-category order within each. Used by Monthly to render one row
   * per group (with a single budget) rather than one row per sub-cat.
   */
  readonly groups = computed<CategoryGroup[]>(() => {
    const out = new Map<string, CategoryGroup>();
    for (const c of this.activeCategories()) {
      const slug = groupSlug(c.group);
      const existing = out.get(slug);
      if (existing) {
        existing.categories.push(c);
        if (c.sortOrder < existing.sortOrder) existing.sortOrder = c.sortOrder;
      } else {
        out.set(slug, {
          slug,
          name: c.group,
          sortOrder: c.sortOrder,
          categories: [c],
        });
      }
    }
    return [...out.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  });

  /** Map<categoryId, groupSlug> — used to bucket transactions by group. */
  readonly groupSlugByCategoryId = computed<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of this.activeCategories()) out[c.id] = groupSlug(c.group);
    return out;
  });
}
