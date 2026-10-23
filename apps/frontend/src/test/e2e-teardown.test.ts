import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteE2eUser, getAdminClient } from '../../e2e/fixtures/admin';
import { teardownTestUser } from '../../e2e/helpers/provision-test-user';

vi.mock('../../e2e/fixtures/admin', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../e2e/fixtures/admin')>(),
  getAdminClient: vi.fn(),
}));

const userId = 'synthetic-user';
const email = 'e2e_synthetic@example.com';
const maybeSingle = vi.fn();
const getUserById = vi.fn();
const rpc = vi.fn();
const deleteUser = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  maybeSingle.mockResolvedValue({ data: { household_id: 'synthetic-household' }, error: null });
  getUserById.mockResolvedValue({ data: { user: { email } }, error: null });
  rpc.mockResolvedValue({ error: null });
  deleteUser.mockResolvedValue({ error: null });
  vi.mocked(getAdminClient).mockReturnValue({
    from, rpc, auth: { admin: { getUserById, deleteUser } },
  } as unknown as ReturnType<typeof getAdminClient>);
});

describe('E2E teardown fail-closed contract', () => {
  for (const teardown of [teardownTestUser, deleteE2eUser]) {
    it(`${teardown.name} resets the household before deleting auth`, async () => {
      await teardown(userId);
      expect(from).toHaveBeenCalledWith('household_members');
      expect(eq).toHaveBeenCalledWith('user_id', userId);
      expect(rpc).toHaveBeenCalledWith('e2e_reset_test_user', { p_email: email });
      expect(deleteUser).toHaveBeenCalledWith(userId);
      expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
    });

    it(`${teardown.name} surfaces RPC permission errors without deleting auth`, async () => {
      rpc.mockResolvedValue({ error: { message: 'permission denied to set session_replication_role' } });
      await expect(teardown(userId)).rejects.toThrow('e2e_reset_test_user RPC failed: permission denied');
      expect(deleteUser).not.toHaveBeenCalled();
    });
  }

  it('fails on a household lookup error instead of treating it as no household', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    await expect(teardownTestUser(userId)).rejects.toThrow('household lookup failed');
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  for (const record of [
    { data: { user: null }, error: { message: 'auth unavailable' } },
    { data: { user: {} }, error: null },
  ]) {
    it('fails if the household owner cannot be resolved to an email', async () => {
      getUserById.mockResolvedValue(record);
      await expect(teardownTestUser(userId)).rejects.toThrow('cleanup user lookup failed');
      expect(rpc).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
    });
  }

  it('surfaces auth deletion failures after household cleanup', async () => {
    deleteUser.mockResolvedValue({ error: { message: 'Database error deleting user' } });
    await expect(teardownTestUser(userId)).rejects.toThrow('auth user deletion failed');
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('deletes an auth-only user without calling the household RPC', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await teardownTestUser(userId);
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).toHaveBeenCalledWith(userId);
  });

  it('remains idempotent for an already absent user', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    deleteUser.mockResolvedValue({ error: { message: 'User not found' } });
    await expect(teardownTestUser(userId)).resolves.toBeUndefined();
  });

  it('preserves explicitly shared users without making requests', async () => {
    vi.stubEnv('E2E_TEST_USER_EMAIL', email);
    await teardownTestUser(userId, { skipShared: true });
    expect(getAdminClient).not.toHaveBeenCalled();
  });
});
