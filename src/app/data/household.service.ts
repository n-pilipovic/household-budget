import { Injectable, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import {
  Firestore,
  Timestamp,
  arrayUnion,
  collection,
  collectionData,
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
import { Observable, of, switchMap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SEED_CATEGORIES } from './seed-categories';
import { generateInviteCode, normaliseInviteCode } from './invite-code';

export type UserColorSlot = 'novica' | 'nada';

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
const COLOR_SLOTS: readonly UserColorSlot[] = ['novica', 'nada'];

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
        return collectionData(q, { idField: 'id' }) as Observable<Household[]>;
      }),
    );

  readonly households = toSignal(this.households$, { initialValue: undefined });
  readonly currentHousehold = computed<Household | null | undefined>(() => {
    const hs = this.households();
    if (hs === undefined) return undefined;
    return hs[0] ?? null;
  });
  readonly isLoading = computed(() => this.households() === undefined);
  readonly hasHousehold = computed(() => {
    const hs = this.households();
    return hs !== undefined && hs.length > 0;
  });

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
    const householdSnap = await getDoc(householdRef);
    if (!householdSnap.exists()) {
      throw new InviteError('orphan', 'The household for this invite no longer exists.');
    }
    const household = householdSnap.data() as Omit<Household, 'id'>;
    if (household.members.includes(u.uid)) {
      return { householdId: data.householdId };
    }

    // Pick a colour slot the existing members aren't using.
    const taken = new Set(Object.values(household.memberColors ?? {}));
    const slot = COLOR_SLOTS.find(c => !taken.has(c))
      ?? COLOR_SLOTS[household.members.length % COLOR_SLOTS.length];

    await updateDoc(householdRef, {
      members: arrayUnion(u.uid),
      [`memberColors.${u.uid}`]: slot,
    });

    // Mark invite as used. Best-effort — failure here doesn't block joining.
    try {
      await updateDoc(inviteRef, {
        usedBy: u.uid,
        usedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Could not mark invite as used', err);
    }

    return { householdId: data.householdId };
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
