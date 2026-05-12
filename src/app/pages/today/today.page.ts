import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../auth/auth.service';
import { CategoryService } from '../../data/category.service';
import { HouseholdService } from '../../data/household.service';
import { Transaction, TransactionService } from '../../data/transaction.service';
import { QuickAddSheet } from './quick-add-sheet';

interface FeedGroup {
  label: string;       // "Today", "Yesterday", "12 May", …
  items: Transaction[];
}

const JUST_SYNCED_MS = 2200;

@Component({
  selector: 'app-today',
  imports: [QuickAddSheet, RouterLink],
  templateUrl: './today.page.html',
})
export class TodayPage {
  private readonly auth = inject(AuthService);
  private readonly households = inject(HouseholdService);
  private readonly categories = inject(CategoryService);
  private readonly transactions = inject(TransactionService);
  private readonly router = inject(Router);

  protected readonly user = this.auth.user;
  protected readonly household = this.households.currentHousehold;
  protected readonly memberProfiles = this.households.memberProfiles;
  protected readonly thisMonthTotal = this.transactions.thisMonthTotal;
  protected readonly recent = this.transactions.recent;
  protected readonly categoriesById = this.categories.byId;

  protected readonly quickAddOpen = signal(false);
  protected readonly editingTx = signal<Transaction | null>(null);
  protected readonly justSyncedIds = signal<Set<string>>(new Set());

  protected readonly myColorSlot = computed(() => {
    const u = this.user();
    const h = this.household();
    if (!u || !h) return '1';
    return h.memberColors?.[u.uid] ?? '1';
  });

  protected readonly groups = computed<FeedGroup[]>(() => {
    const items = this.recent();
    if (items.length === 0) return [];

    const today = startOfDay(new Date());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const grouped = new Map<number, Transaction[]>();
    for (const t of items) {
      const ts = t.occurredOn?.toDate ? t.occurredOn.toDate() : new Date();
      const dayKey = startOfDay(ts).getTime();
      const list = grouped.get(dayKey) ?? [];
      list.push(t);
      grouped.set(dayKey, list);
    }

    const sortedKeys = [...grouped.keys()].sort((a, b) => b - a);
    return sortedKeys.map(k => {
      let label: string;
      if (k === today.getTime()) label = 'Today';
      else if (k === yesterday.getTime()) label = 'Yesterday';
      else label = formatShortDate(new Date(k));
      return { label, items: grouped.get(k)! };
    });
  });

  protected readonly monthName = computed(() => {
    const now = new Date();
    return now.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
  });

  protected readonly daysRemaining = computed(() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return lastDay - now.getDate();
  });

  constructor() {
    // Detect transactions newly arrived via realtime (not by us) and
    // highlight them for ~2 seconds.
    let previousIds = new Set<string>();
    let primed = false;
    effect(() => {
      const items = this.recent();
      const uid = this.user()?.uid;
      const currentIds = new Set(items.map(t => t.id));

      if (!primed) {
        primed = true;
        previousIds = currentIds;
        return;
      }

      const additions: string[] = [];
      for (const t of items) {
        if (previousIds.has(t.id)) continue;
        // Only highlight partner's adds, not your own optimistic insert.
        if (t.userId === uid) continue;
        additions.push(t.id);
      }
      previousIds = currentIds;

      if (additions.length > 0) {
        const next = new Set(this.justSyncedIds());
        for (const id of additions) next.add(id);
        this.justSyncedIds.set(next);
        for (const id of additions) {
          setTimeout(() => {
            const cur = new Set(this.justSyncedIds());
            cur.delete(id);
            this.justSyncedIds.set(cur);
          }, JUST_SYNCED_MS);
        }
      }
    });
  }

  openQuickAdd() {
    this.editingTx.set(null);
    this.quickAddOpen.set(true);
  }

  openEdit(t: Transaction) {
    this.editingTx.set(t);
    this.quickAddOpen.set(true);
  }

  closeQuickAdd() {
    this.quickAddOpen.set(false);
    // Clear editing state next tick so the sheet's close animation
    // doesn't show "Editing transaction" while collapsing.
    setTimeout(() => this.editingTx.set(null), 200);
  }

  async signOut() {
    await this.auth.signOut();
    await this.router.navigateByUrl('/sign-in');
  }

  formatAmount(n: number): string {
    return n.toLocaleString('de-DE');
  }

  formatTime(ts: { toDate(): Date } | undefined): string {
    if (!ts) return '';
    return ts.toDate().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  colorSlotFor(uid: string): '1' | '2' {
    const h = this.household();
    return (h?.memberColors?.[uid] as '1' | '2' | undefined) ?? '1';
  }

  initialFor(t: Transaction): string {
    return (t.note?.[0] || '?').toUpperCase();
  }

  categoryNameFor(id: string): string {
    return this.categoriesById()[id]?.name ?? 'Other';
  }

  isJustSynced(id: string): boolean {
    return this.justSyncedIds().has(id);
  }

  /** First letter of the user's display name (or email fallback). */
  displayInitialForUser(uid: string): string {
    // Self: use the live Firebase Auth user so we don't depend on the
    // Firestore /users/{uid} doc being loaded.
    const u = this.user();
    if (u && u.uid === uid) {
      return (u.displayName?.[0] ?? u.email?.[0] ?? '?').toUpperCase();
    }
    // Partner(s): use the cached profile loaded by HouseholdService.
    const profile = this.memberProfiles().get(uid);
    if (profile) {
      return (profile.displayName?.[0] ?? profile.email?.[0] ?? '?').toUpperCase();
    }
    return '?';
  }

  /** Full display name for the user who logged a row, when needed. */
  displayNameForUser(uid: string): string {
    const u = this.user();
    if (u && u.uid === uid) {
      return u.displayName ?? u.email?.split('@')[0] ?? 'You';
    }
    const profile = this.memberProfiles().get(uid);
    if (profile) {
      return profile.displayName ?? profile.email?.split('@')[0] ?? 'Member';
    }
    return 'Member';
  }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatShortDate(d: Date): string {
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short' });
}
