import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to mock the supabase module before importing authBootstrap
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
    },
  },
}));

// Import after mocking
import { awaitAuthReady, resetAuthBootstrap } from '../authBootstrap';
import { supabase } from '../supabase';

const mockGetSession = supabase.auth.getSession as ReturnType<typeof vi.fn>;
const mockOnAuthStateChange = supabase.auth.onAuthStateChange as ReturnType<typeof vi.fn>;

describe('authBootstrap', () => {
  beforeEach(() => {
    // Reset the module-level cache between tests
    resetAuthBootstrap();
    vi.clearAllMocks();

    // Default: onAuthStateChange returns a no-op subscription
    mockOnAuthStateChange.mockReturnValue({
      data: {
        subscription: { unsubscribe: vi.fn() },
      },
    });
  });

  describe('awaitAuthReady - fast path (getSession returns session)', () => {
    it('returns the user and session when getSession resolves immediately', async () => {
      const mockUser = { id: 'user-123', email: 'test@example.com' };
      const mockSession = { user: mockUser, access_token: 'token' };

      mockGetSession.mockResolvedValueOnce({ data: { session: mockSession }, error: null });

      const result = await awaitAuthReady();

      expect(result.user).toBe(mockUser);
      expect(result.session).toBe(mockSession);
    });

    it('caches the result so subsequent calls do not re-call getSession', async () => {
      const mockUser = { id: 'user-456' };
      const mockSession = { user: mockUser };

      mockGetSession.mockResolvedValue({ data: { session: mockSession }, error: null });

      const result1 = await awaitAuthReady();
      const result2 = await awaitAuthReady();

      expect(result1).toBe(result2);
      // getSession should only be called once despite two awaitAuthReady calls
      expect(mockGetSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('awaitAuthReady - slow path (getSession returns null, waits for state change)', () => {
    it('resolves with user when SIGNED_IN fires after null getSession', async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });

      const mockUser = { id: 'user-789' };
      const mockSession = { user: mockUser };
      let capturedCallback: ((event: string, session: any) => void) | null = null;

      mockOnAuthStateChange.mockImplementation((callback: (event: string, session: any) => void) => {
        capturedCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });

      // Start the bootstrap
      const promise = awaitAuthReady();

      // Simulate SIGNED_IN event arriving shortly after
      await Promise.resolve(); // yield to allow getSession to complete
      await Promise.resolve();
      capturedCallback!('SIGNED_IN', mockSession);

      const result = await promise;
      expect(result.user).toBe(mockUser);
      expect(result.session).toBe(mockSession);
    });

    it('resolves with user when TOKEN_REFRESHED fires after null getSession', async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });

      const mockUser = { id: 'user-101' };
      const mockSession = { user: mockUser };
      let capturedCallback: ((event: string, session: any) => void) | null = null;

      mockOnAuthStateChange.mockImplementation((callback: (event: string, session: any) => void) => {
        capturedCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });

      const promise = awaitAuthReady();
      await Promise.resolve();
      await Promise.resolve();
      capturedCallback!('TOKEN_REFRESHED', mockSession);

      const result = await promise;
      expect(result.user).toBe(mockUser);
    });

    it('resolves with user when INITIAL_SESSION fires with a session', async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });

      const mockUser = { id: 'user-initial' };
      const mockSession = { user: mockUser };
      let capturedCallback: ((event: string, session: any) => void) | null = null;

      mockOnAuthStateChange.mockImplementation((callback: (event: string, session: any) => void) => {
        capturedCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });

      const promise = awaitAuthReady();
      await Promise.resolve();
      await Promise.resolve();
      capturedCallback!('INITIAL_SESSION', mockSession);

      const result = await promise;
      expect(result.user).toBe(mockUser);
    });

    it('resolves with null user when SIGNED_OUT fires', async () => {
      mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });

      let capturedCallback: ((event: string, session: any) => void) | null = null;

      mockOnAuthStateChange.mockImplementation((callback: (event: string, session: any) => void) => {
        capturedCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      });

      const promise = awaitAuthReady();
      await Promise.resolve();
      await Promise.resolve();
      capturedCallback!('SIGNED_OUT', null);

      const result = await promise;
      expect(result.user).toBeNull();
      expect(result.session).toBeNull();
    });

    it('resolves with null user after timeout when no auth state change fires', async () => {
      vi.useFakeTimers();

      mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null });

      mockOnAuthStateChange.mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      });

      const promise = awaitAuthReady(1000);

      // Allow getSession to resolve
      await Promise.resolve();
      await Promise.resolve();

      // Advance past the timeout
      vi.advanceTimersByTime(1001);

      const result = await promise;
      expect(result.user).toBeNull();
      expect(result.session).toBeNull();

      vi.useRealTimers();
    });
  });

  describe('resetAuthBootstrap', () => {
    it('allows awaitAuthReady to re-run after reset', async () => {
      const mockSession1 = { user: { id: 'first' } };
      const mockSession2 = { user: { id: 'second' } };

      mockGetSession
        .mockResolvedValueOnce({ data: { session: mockSession1 }, error: null })
        .mockResolvedValueOnce({ data: { session: mockSession2 }, error: null });

      const result1 = await awaitAuthReady();
      expect(result1.session).toBe(mockSession1);

      resetAuthBootstrap();

      const result2 = await awaitAuthReady();
      expect(result2.session).toBe(mockSession2);
    });
  });
});
