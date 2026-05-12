import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FirebaseError } from '@angular/fire/app';
import {
  Firestore,
  Timestamp,
  arrayRemove,
  arrayUnion,
  collection,
  collectionData,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '@angular/fire/firestore';
import { Observable, from, of, switchMap } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthService } from '../auth/auth.service';
import { SEED_CATEGORIES } from './seed-categories';
import { generateInviteCode, normaliseInviteCode } from './invite-code';
import type { UserProfile } from './user.service';

export type UserColorSlot = '1' | '2';

export interface Household {
  id: string;
  name: string;
  members: string[];
  memberColors: { [uid: string]: UserColorSlot };
  createdBy: string;
  createdAt: Timestamp;
}

export interface InviteDoc {
  householdId: string;
  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  usedBy?: string;
  usedAt?: Timestamp;
}

const INVITE_TTL_DAYS = 7;
const COLOR_SLOTS: readonly UserColorSlot[] = ['1', '2'];

@Injectable({ providedIn: 'root' })
export class HouseholdService {
  private readonly auth = inject(AuthService);
  private readonly firestore = inject(Firestore);

  /**
   * All households the current user is a member of, kept live via
   * collectionData. Empty array → user needs to onboard.
   * undefined → still resolving auth or query.
   */
  private readonly households$: Observable<Household[] | undefined> =
    toObservable(this.auth.user).pipe(
      switchMap(u => {
        if (u === undefined) return of(undefined);
        if (u === null) return of([] as Household[]);
        const q = query(
          collection(this.firestore, 'households'),
          where('members', 'array-contains', u.uid),
        );
        return (collectionData(q, { idField: 'id' }) as Observable<Household[]>)
          .pipe(map(docs => docs.map(normaliseHousehold)));
      }),
    );

  readonly households = toSignal(this.households$, { initialValue: undefined });

  /**
   * The user's choice of which household to view (persisted per
   * device in localStorage). Null until set, in which case currentHousehold
   * falls back to the first household the user belongs to.
   */
  private readonly activeHouseholdIdSignal = signal<string | null>(readActiveId());
  readonly activeHouseholdId = this.activeHouseholdIdSignal.asReadonly();

  readonly currentHousehold = computed<Household | null | undefined>(() => {
    const hs = this.households();
    if (hs === undefined) return undefined;
    if (hs.length === 0) return null;
    const activeId = this.activeHouseholdIdSignal();
    return hs.find(h => h.id === activeId) ?? hs[0];
  });

  readonly isLoading = computed(() => this.households() === undefined);
  readonly hasHousehold = computed(() => {
    const hs = this.households();
    return hs !== undefined && hs.length > 0;
  });

  constructor() {
    // Keep the active id valid: if the user leaves a household or it
    // disappears, reset to the first remaining one (or null).
    effect(() => {
      const hs = this.households();
      if (!hs || hs.length === 0) return;
      const active = this.activeHouseholdIdSignal();
      if (active && hs.some(h => h.id === active)) return;
      // Active id missing → adopt the first one as the new active.
      this.setActiveHousehold(hs[0].id);
    });
  }

  setActiveHousehold(hid: string): void {
    this.activeHouseholdIdSignal.set(hid);
    try { localStorage.setItem('activeHouseholdId', hid); } catch { /* noop */ }
  }

  /**
   * Profiles for every member of the current household, keyed by uid.
   * Refetched whenever the household changes or its member list grows.
   * Used by the feed to render real initials (and later names) for
   * partner-attributed rows instead of placeholder 'N's.
   */
  private readonly memberProfiles$: Observable<Map<string, UserProfile>> =
    toObservable(this.currentHousehold).pipe(
      switchMap(h => {
        if (!h) return of(new Map<string, UserProfile>());
        return from(this.loadMemberProfiles(h.members));
      }),
    );

  readonly memberProfiles = toSignal(this.memberProfiles$, {
    initialValue: new Map<string, UserProfile>(),
  });

  private async loadMemberProfiles(uids: string[]): Promise<Map<string, UserProfile>> {
    const entries = await Promise.all(
      uids.map(async uid => {
        try {
          const snap = await getDoc(doc(this.firestore, 'users', uid));
          return [uid, snap.exists() ? (snap.data() as UserProfile) : null] as const;
        } catch (err) {
          // Rules deny reading other users' docs by default; this is
          // expected during bootstrap before /users/{uid} exists for
          // every member. Treat as missing and move on.
          console.warn(`Could not read user profile ${uid}`, err);
          return [uid, null] as const;
        }
      }),
    );
    const out = new Map<string, UserProfile>();
    for (const [uid, profile] of entries) {
      if (profile) out.set(uid, profile);
    }
    return out;
  }

  /**
   * Create a new household with the signed-in user as the first
   * member, seed all categories, and generate an invite code.
   */
  async createHousehold(name: string): Promise<{ householdId: string; inviteCode: string }> {
    const u = this.auth.user();
    if (!u) throw new Error('Not authenticated');

    const trimmed = name.trim();
    if (!trimmed) throw new Error('Household name is required');

    // 1. Create the household doc with a new auto-id
    const householdsCol = collection(this.firestore, 'households');
    const householdRef = doc(householdsCol);
    await setDoc(householdRef, {
      name: trimmed,
      members: [u.uid],
      memberColors: { [u.uid]: COLOR_SLOTS[0] },
      createdBy: u.uid,
      createdAt: serverTimestamp(),
    });

    // 2. Seed categories in a batch
    const batch = writeBatch(this.firestore);
    for (const cat of SEED_CATEGORIES) {
      const ref = doc(this.firestore, 'households', householdRef.id, 'categories', cat.id);
      batch.set(ref, {
        group: cat.group,
        name: cat.name,
        icon: cat.icon ?? null,
        sortOrder: cat.sortOrder,
        active: true,
      });
    }
    await batch.commit();

    // 3. Generate an invite code
    const code = await this.createInvite(householdRef.id);

    // Auto-switch the active household to the newly-created one so the
    // user lands on it in Today/Monthly without manually picking.
    this.setActiveHousehold(householdRef.id);

    return { householdId: householdRef.id, inviteCode: code };
  }

  /**
   * Generate a fresh invite code for an existing household. The
   * caller must already be a member.
   */
  async createInvite(householdId: string): Promise<string> {
    const u = this.auth.user();
    if (!u) throw new Error('Not authenticated');

    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      const ref = doc(this.firestore, 'invites', code);
      const existing = await getDoc(ref);
      if (existing.exists()) continue;
      const now = Date.now();
      await setDoc(ref, {
        householdId,
        createdBy: u.uid,
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(now + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
      });
      return code;
    }
    throw new Error('Could not generate a unique invite code, please retry.');
  }

  /**
   * Join the household referenced by an invite code. Validates the
   * code exists, isn't expired, and hasn't been used by someone else.
   *
   * Implementation note: the joiner is NOT yet a member of the
   * household, so they can't `getDoc(households/{hid})` under our
   * rules (read requires `auth.uid in resource.data.members`). To
   * avoid relaxing the read rule, we skip the household read and
   * pick a color slot deterministically. Slot is hardcoded to '2'
   * since the MVP has at most 2 members per household; revisit when
   * household.members can exceed 2.
   */
  async joinByCode(rawCode: string): Promise<{ householdId: string }> {
    const u = this.auth.user();
    if (!u) throw new Error('Not authenticated');

    const code = normaliseInviteCode(rawCode);
    const inviteRef = doc(this.firestore, 'invites', code);
    const inviteSnap = await getDoc(inviteRef);
    if (!inviteSnap.exists()) throw new InviteError('not-found', 'Invite code not found.');

    const data = inviteSnap.data() as InviteDoc;
    if (data.expiresAt.toMillis() < Date.now()) {
      throw new InviteError('expired', 'This invite code has expired.');
    }
    if (data.usedBy && data.usedBy !== u.uid) {
      throw new InviteError('used', 'This invite code has already been used.');
    }

    const householdRef = doc(this.firestore, 'households', data.householdId);
    const slot: UserColorSlot = '2';

    try {
      await updateDoc(householdRef, {
        members: arrayUnion(u.uid),
        [`memberColors.${u.uid}`]: slot,
      });
    } catch (err) {
      if (err instanceof FirebaseError && err.code === 'not-found') {
        throw new InviteError('orphan', 'The household for this invite no longer exists.');
      }
      throw err;
    }

    // Mark invite as used. Best-effort — failure here doesn't block joining.
    try {
      await updateDoc(inviteRef, {
        usedBy: u.uid,
        usedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Could not mark invite as used', err);
    }

    // Auto-switch the active household to the newly-joined one.
    this.setActiveHousehold(data.householdId);

    return { householdId: data.householdId };
  }

  /**
   * Leave a household: remove self from `members` and `memberColors`.
   * Caller must currently be a member.
   *
   * Returns the leftover household count so callers can decide what
   * to do next (e.g. redirect to /onboarding if 0 remain).
   *
   * Edge case: if the user is the last member, the household becomes
   * orphaned — its data (categories, transactions, budgets) stays in
   * Firestore but no one has read access. Hardening (cleanup or
   * "you can't leave as the last member") can come later.
   */
  async leaveHousehold(hid: string): Promise<{ remaining: number; wasLastMember: boolean }> {
    const u = this.auth.user();
    if (!u) throw new Error('Not authenticated');
    if (!hid) throw new Error('Household id is required');

    const ref = doc(this.firestore, 'households', hid);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Household not found');
    const data = snap.data() as Omit<Household, 'id'>;
    if (!data.members.includes(u.uid)) {
      throw new Error('You are not a member of this household');
    }
    const wasLastMember = data.members.length === 1;

    await updateDoc(ref, {
      members: arrayRemove(u.uid),
      [`memberColors.${u.uid}`]: deleteField(),
    });

    // If the user just left the currently-active household, drop the
    // stored id so the effect picks a new active on the next tick.
    if (this.activeHouseholdIdSignal() === hid) {
      this.activeHouseholdIdSignal.set(null);
      try { localStorage.removeItem('activeHouseholdId'); } catch { /* noop */ }
    }

    const remainingSnap = await this.listMyHouseholds();
    return { remaining: remainingSnap.length, wasLastMember };
  }

  /** Rename the current household. Caller must be a member. */
  async renameHousehold(newName: string): Promise<void> {
    const h = this.currentHousehold();
    if (!h) throw new Error('No household selected');
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Name cannot be empty');
    if (trimmed === h.name) return;
    const ref = doc(this.firestore, 'households', h.id);
    await updateDoc(ref, { name: trimmed });
  }

  /** One-shot list — used by guards. */
  async listMyHouseholds(): Promise<Household[]> {
    const u = this.auth.user();
    if (!u) return [];
    const q = query(
      collection(this.firestore, 'households'),
      where('members', 'array-contains', u.uid),
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Household, 'id'>) }));
  }
}

export class InviteError extends Error {
  constructor(
    public readonly code: 'not-found' | 'expired' | 'used' | 'orphan',
    message: string,
  ) {
    super(message);
    this.name = 'InviteError';
  }
}

/**
 * Normalise a Household doc read from Firestore: maps legacy color
 * slot identifiers from the pre-rename era ('novica' / 'nada') onto
 * the current neutral slot scheme ('1' / '2'). New writes always use
 * the neutral scheme; this only kicks in for docs created before
 * the rename. Safe to remove once all households have been migrated.
 */
function normaliseHousehold(h: Household): Household {
  const src = h.memberColors;
  if (!src) return h;
  const fixed: { [uid: string]: UserColorSlot } = {};
  for (const [uid, slot] of Object.entries(src)) {
    fixed[uid] = mapLegacySlot(slot);
  }
  return { ...h, memberColors: fixed };
}

function mapLegacySlot(raw: unknown): UserColorSlot {
  if (raw === '1' || raw === '2') return raw;
  if (raw === 'novica') return '1';
  if (raw === 'nada') return '2';
  return '1'; // safe fallback for unexpected values
}

/** Active household preference stored per device via localStorage. */
function readActiveId(): string | null {
  try {
    return localStorage.getItem('activeHouseholdId');
  } catch {
    return null;
  }
}
