import { Component, computed, effect, inject, input, output, signal, viewChild, ElementRef } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { CategoryService, Category } from '../../data/category.service';
import { HouseholdService } from '../../data/household.service';
import { Transaction, TransactionService } from '../../data/transaction.service';
import { parseQuickAdd, suggestCategories } from '../../data/parser';

interface CategoryGroup {
  name: string;
  categories: Category[];
}

@Component({
  selector: 'app-quick-add-sheet',
  imports: [],
  templateUrl: './quick-add-sheet.html',
})
export class QuickAddSheet {
  readonly open = input<boolean>(false);
  /** When set, the sheet is in edit mode: prefilled + saves via update. */
  readonly editing = input<Transaction | null>(null);
  readonly close = output<void>();

  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);
  private readonly categories = inject(CategoryService);
  private readonly transactions = inject(TransactionService);

  protected readonly raw = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedCategoryId = signal<string | null>(null);
  protected readonly showAll = signal(false);

  // Manual override flag — once the user taps a chip or picks from the
  // full list, stop auto-selecting based on note changes. Reset when
  // the sheet is reopened in create mode.
  private readonly userPickedCategory = signal(false);

  protected readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('input');

  protected readonly isEditMode = computed(() => this.editing() !== null);

  protected readonly parsed = computed(() => parseQuickAdd(this.raw()));

  /** Suggested category IDs based on the note (top first). */
  protected readonly suggestedIds = computed(() => {
    const { note } = this.parsed();
    return suggestCategories(note);
  });

  /** First 3 chips for the quick suggestions row. */
  protected readonly suggestedChips = computed<Category[]>(() => {
    const byId = this.categories.byId();
    return this.suggestedIds().slice(0, 3).map(id => byId[id]).filter((c): c is Category => !!c);
  });

  /** All active categories grouped by their top-level group. */
  protected readonly grouped = computed<CategoryGroup[]>(() => {
    const groups = new Map<string, Category[]>();
    for (const c of this.categories.activeCategories()) {
      const list = groups.get(c.group) ?? [];
      list.push(c);
      groups.set(c.group, list);
    }
    return [...groups.entries()].map(([name, categories]) => ({ name, categories }));
  });

  /** Active selection — falls back to the top suggestion if user hasn't picked. */
  protected readonly effectiveCategoryId = computed(() =>
    this.selectedCategoryId() ?? this.suggestedIds()[0] ?? null,
  );

  protected readonly effectiveCategory = computed<Category | null>(() => {
    const id = this.effectiveCategoryId();
    if (!id) return null;
    return this.categories.byId()[id] ?? null;
  });

  /** True when the effective category isn't in the top 3 chips (i.e. user picked from "all"). */
  protected readonly effectiveCategoryIsExtra = computed(() => {
    const eff = this.effectiveCategoryId();
    if (!eff) return false;
    return !this.suggestedChips().some(c => c.id === eff);
  });

  protected readonly canSubmit = computed(() => {
    const p = this.parsed();
    return !this.busy() && p.amount !== null && p.amount !== 0 && !!this.effectiveCategoryId();
  });

  protected readonly currentUser = this.auth.user;
  protected readonly currentHousehold = this.households.currentHousehold;
  protected readonly myColorSlot = computed(() => {
    const u = this.currentUser();
    const h = this.currentHousehold();
    if (!u || !h) return '1';
    return h.memberColors?.[u.uid] ?? '1';
  });

  constructor() {
    // When the sheet opens, populate state from edit target (if any).
    effect(() => {
      if (!this.open()) return;
      const t = this.editing();
      this.error.set(null);
      this.showAll.set(false);
      if (t) {
        // Edit mode: prefill from the transaction.
        this.raw.set(`${t.amount} ${t.note}`.trim());
        this.selectedCategoryId.set(t.categoryId);
        this.userPickedCategory.set(true);
      } else {
        this.raw.set('');
        this.selectedCategoryId.set(null);
        this.userPickedCategory.set(false);
      }
      setTimeout(() => this.inputRef()?.nativeElement.focus(), 30);
    });

    // Clear auto-selected category whenever the note changes,
    // unless the user has explicitly picked one.
    effect(() => {
      void this.parsed().note;
      if (this.userPickedCategory()) return;
      this.selectedCategoryId.set(null);
    });
  }

  closeSheet() {
    this.close.emit();
  }

  onInput(value: string) {
    this.raw.set(value);
  }

  pickCategory(id: string) {
    this.userPickedCategory.set(true);
    this.selectedCategoryId.set(id);
    this.showAll.set(false);
  }

  toggleShowAll() {
    this.showAll.update(v => !v);
  }

  async submit(e: SubmitEvent) {
    e.preventDefault();
    if (!this.canSubmit()) return;
    const { amount, note } = this.parsed();
    const categoryId = this.effectiveCategoryId();
    if (amount === null || !categoryId) return;

    this.busy.set(true);
    this.error.set(null);
    try {
      const editing = this.editing();
      if (editing) {
        await this.transactions.updateTransaction(editing.id, { amount, note, categoryId });
      } else {
        await this.transactions.addTransaction({ amount, note, categoryId });
      }
      this.closeSheet();
    } catch (err) {
      console.error('saveTransaction failed', err);
      this.error.set(err instanceof Error ? err.message : 'Could not save. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  async deleteTransaction() {
    const t = this.editing();
    if (!t) return;
    if (!window.confirm('Delete this transaction?')) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.transactions.deleteTransaction(t.id);
      this.closeSheet();
    } catch (err) {
      console.error('deleteTransaction failed', err);
      this.error.set(err instanceof Error ? err.message : 'Could not delete. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  formatAmount(n: number): string {
    return n.toLocaleString('de-DE');
  }
}
