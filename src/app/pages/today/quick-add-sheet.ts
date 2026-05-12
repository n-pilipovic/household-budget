import { Component, computed, effect, inject, input, output, signal, viewChild, ElementRef } from '@angular/core';
import { AuthService } from '../../auth/auth.service';
import { CategoryService, Category } from '../../data/category.service';
import { HouseholdService } from '../../data/household.service';
import { TransactionService } from '../../data/transaction.service';
import { parseQuickAdd, suggestCategories } from '../../data/parser';

@Component({
  selector: 'app-quick-add-sheet',
  imports: [],
  templateUrl: './quick-add-sheet.html',
})
export class QuickAddSheet {
  readonly open = input<boolean>(false);
  readonly close = output<void>();

  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);
  private readonly categories = inject(CategoryService);
  private readonly transactions = inject(TransactionService);

  protected readonly raw = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly selectedCategoryId = signal<string | null>(null);

  // Manual override flag — once the user taps a chip, stop auto-selecting
  // based on note changes. Reset when the sheet closes/opens.
  private readonly userPickedCategory = signal(false);

  protected readonly inputRef = viewChild<ElementRef<HTMLInputElement>>('input');

  protected readonly parsed = computed(() => parseQuickAdd(this.raw()));

  /** Suggested category IDs based on the note. Top entry = best guess. */
  protected readonly suggestedIds = computed(() => {
    const { note } = this.parsed();
    return suggestCategories(note);
  });

  /** First 3 visible chips for the suggestions strip. */
  protected readonly suggestedChips = computed<Category[]>(() => {
    const byId = this.categories.byId();
    const top = this.suggestedIds().slice(0, 3);
    return top.map(id => byId[id]).filter((c): c is Category => !!c);
  });

  /** Active selection — falls back to the top suggestion if user hasn't tapped one. */
  protected readonly effectiveCategoryId = computed(() =>
    this.selectedCategoryId() ?? this.suggestedIds()[0] ?? null,
  );

  protected readonly effectiveCategory = computed<Category | null>(() => {
    const id = this.effectiveCategoryId();
    if (!id) return null;
    return this.categories.byId()[id] ?? null;
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
    if (!u || !h) return 'novica';
    return h.memberColors?.[u.uid] ?? 'novica';
  });

  constructor() {
    // When the sheet opens, reset state and focus the input.
    effect(() => {
      if (this.open()) {
        this.raw.set('');
        this.error.set(null);
        this.selectedCategoryId.set(null);
        this.userPickedCategory.set(false);
        // Defer focus to next frame so the element is rendered.
        setTimeout(() => this.inputRef()?.nativeElement.focus(), 30);
      }
    });

    // When the note changes (and the user hasn't manually picked a chip),
    // keep the auto-selected category in sync.
    effect(() => {
      const note = this.parsed().note;
      if (this.userPickedCategory()) return;
      // Touch suggestions so the effect re-runs when the note changes.
      void this.suggestedIds();
      this.selectedCategoryId.set(null);
      void note;
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
      await this.transactions.addTransaction({ amount, note, categoryId });
      this.closeSheet();
    } catch (err) {
      console.error('addTransaction failed', err);
      this.error.set(err instanceof Error ? err.message : 'Could not save. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  formatAmount(n: number): string {
    return n.toLocaleString('de-DE');
  }
}
