import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — all vi.fn() used inside vi.mock() factories must be hoisted
// so they are initialized before the factory closures run.
// ---------------------------------------------------------------------------
const { mockInsert, mockSelect, mockSingle, mockGetUser, mockHeaders } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockSingle: vi.fn(),
  mockGetUser: vi.fn(),
  mockHeaders: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      insert: mockInsert.mockReturnValue({
        select: mockSelect.mockReturnValue({
          single: mockSingle,
        }),
      }),
    })),
  })),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
  })),
}));

import {
  recordHouseholdEvent,
  recordHouseholdCreated,
  recordInviteCreated,
  recordInviteAccepted,
  recordInviteRevoked,
  recordRoleChanged,
  recordMemberRemoved,
  recordMemberLeft,
  recordHouseholdRenamed,
} from './audit';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const HH_ID = 'household-uuid-001';
const USER_ID = 'user-uuid-001';
const TARGET_ID = 'user-uuid-002';
const INVITE_ID = 'invite-uuid-001';

function okResult(id = 'audit-row-001') {
  return { data: { id }, error: null };
}

function errResult(msg = 'DB error') {
  return { data: null, error: { message: msg } };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();

  // Default: headers resolves with an IP and UA
  mockHeaders.mockResolvedValue({
    get: (key: string) => {
      if (key === 'x-forwarded-for') return '203.0.113.1';
      if (key === 'user-agent') return 'TestAgent/1.0';
      return null;
    },
  });

  // Default: session user resolves to USER_ID
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });

  // Default: insert succeeds
  mockSingle.mockResolvedValue(okResult());
});

// ---------------------------------------------------------------------------
// Core: recordHouseholdEvent
// ---------------------------------------------------------------------------
describe('recordHouseholdEvent', () => {
  it('returns ok:true with the new row id on success', async () => {
    mockSingle.mockResolvedValue(okResult('row-123'));
    const result = await recordHouseholdEvent({ householdId: HH_ID, action: 'household_created' });
    expect(result).toEqual({ ok: true, id: 'row-123' });
  });

  it('returns ok:false with error message on DB failure', async () => {
    mockSingle.mockResolvedValue(errResult('constraint violation'));
    const result = await recordHouseholdEvent({ householdId: HH_ID, action: 'invite_created' });
    expect(result).toEqual({ ok: false, error: 'constraint violation' });
  });

  it('resolves actorUserId from session when not provided', async () => {
    await recordHouseholdEvent({ householdId: HH_ID, action: 'member_left' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: USER_ID }),
    );
  });

  it('uses explicitly provided actorUserId without querying session', async () => {
    await recordHouseholdEvent({ householdId: HH_ID, action: 'member_removed', actorUserId: 'explicit-actor' });
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'explicit-actor' }),
    );
  });

  it('records null actor for system events (actorUserId: null)', async () => {
    await recordHouseholdEvent({ householdId: HH_ID, action: 'household_created', actorUserId: null });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null }),
    );
  });

  it('captures IP from x-forwarded-for header', async () => {
    await recordHouseholdEvent({ householdId: HH_ID, action: 'invite_revoked', actorUserId: USER_ID });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_ip: '203.0.113.1' }),
    );
  });

  it('takes first IP from x-forwarded-for chain', async () => {
    mockHeaders.mockResolvedValue({
      get: (key: string) => {
        if (key === 'x-forwarded-for') return '10.0.0.1, 172.16.0.1, 203.0.113.1';
        return null;
      },
    });
    await recordHouseholdEvent({ householdId: HH_ID, action: 'role_changed', actorUserId: USER_ID });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_ip: '10.0.0.1' }),
    );
  });

  it('captures user-agent header', async () => {
    await recordHouseholdEvent({ householdId: HH_ID, action: 'member_left' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_user_agent: 'TestAgent/1.0' }),
    );
  });

  it('sets null IP and UA when headers() throws (background job context)', async () => {
    mockHeaders.mockRejectedValue(new Error('headers not available outside request'));
    await recordHouseholdEvent({ householdId: HH_ID, action: 'invite_accepted', actorUserId: USER_ID });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_ip: null, actor_user_agent: null }),
    );
  });

  it('passes target_user_id when provided', async () => {
    await recordHouseholdEvent({
      householdId: HH_ID,
      action: 'member_removed',
      actorUserId: USER_ID,
      targetUserId: TARGET_ID,
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ target_user_id: TARGET_ID }),
    );
  });

  it('passes target_invite_id when provided', async () => {
    await recordHouseholdEvent({
      householdId: HH_ID,
      action: 'invite_revoked',
      actorUserId: USER_ID,
      targetInviteId: INVITE_ID,
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ target_invite_id: INVITE_ID }),
    );
  });

  it('passes metadata JSONB', async () => {
    const metadata = { previous_role: 'member', new_role: 'owner' };
    await recordHouseholdEvent({
      householdId: HH_ID,
      action: 'role_changed',
      actorUserId: USER_ID,
      targetUserId: TARGET_ID,
      metadata,
    });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata }),
    );
  });

  it('defaults metadata to empty object when omitted', async () => {
    await recordHouseholdEvent({ householdId: HH_ID, action: 'member_left' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: {} }),
    );
  });

  it('falls back to null actor when session getUser fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'not signed in' } });
    await recordHouseholdEvent({ householdId: HH_ID, action: 'household_created' });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// Convenience wrappers
// ---------------------------------------------------------------------------
describe('recordHouseholdCreated', () => {
  it('emits household_created action', async () => {
    await recordHouseholdCreated(HH_ID, USER_ID);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'household_created', household_id: HH_ID }),
    );
  });
});

describe('recordInviteCreated', () => {
  it('emits invite_created with invitee email but no raw token', async () => {
    await recordInviteCreated(HH_ID, INVITE_ID, 'alice@example.com');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invite_created',
        target_invite_id: INVITE_ID,
        metadata: { invitee_email: 'alice@example.com' },
      }),
    );
    // Sanity: no raw token field in metadata
    const call = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    const metadata = call.metadata as Record<string, unknown>;
    expect(metadata).not.toHaveProperty('token');
    expect(metadata).not.toHaveProperty('invite_token');
  });
});

describe('recordInviteAccepted', () => {
  it('emits invite_accepted with target user and invite id', async () => {
    await recordInviteAccepted(HH_ID, TARGET_ID, INVITE_ID);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invite_accepted',
        target_user_id: TARGET_ID,
        target_invite_id: INVITE_ID,
      }),
    );
  });
});

describe('recordInviteRevoked', () => {
  it('emits invite_revoked with invite id', async () => {
    await recordInviteRevoked(HH_ID, INVITE_ID);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'invite_revoked',
        target_invite_id: INVITE_ID,
      }),
    );
  });
});

describe('recordRoleChanged', () => {
  it('emits role_changed with before/after role in metadata', async () => {
    await recordRoleChanged(HH_ID, TARGET_ID, 'viewer', 'member');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role_changed',
        target_user_id: TARGET_ID,
        metadata: { previous_role: 'viewer', new_role: 'member' },
      }),
    );
  });
});

describe('recordMemberRemoved', () => {
  it('emits member_removed targeting the removed user', async () => {
    await recordMemberRemoved(HH_ID, TARGET_ID);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'member_removed',
        target_user_id: TARGET_ID,
      }),
    );
  });
});

describe('recordMemberLeft', () => {
  it('emits member_left with the actor as the leaver', async () => {
    await recordMemberLeft(HH_ID);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'member_left', household_id: HH_ID }),
    );
  });
});

describe('recordHouseholdRenamed', () => {
  it('emits household_renamed with name diff in metadata', async () => {
    await recordHouseholdRenamed(HH_ID, 'Old Name', 'New Name');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'household_renamed',
        metadata: { previous_name: 'Old Name', new_name: 'New Name' },
      }),
    );
  });
});
