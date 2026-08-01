import { createServerClient } from '@supabase/ssr';

jest.mock('@supabase/ssr', () => ({
  createServerClient: jest.fn(),
}));

describe('Supabase Server Client', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test-url.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should call createServerClient with correct parameters', () => {
    jest.isolateModules(() => {
      const { createClient } = require('./server');
      const mockCookieStore = {
        getAll: jest.fn().mockReturnValue([{ name: 'test', value: 'value' }]),
        setAll: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        has: jest.fn(),
        clear: jest.fn(),
      } as any;

      createClient(mockCookieStore);

      expect(createServerClient).toHaveBeenCalledTimes(1);
      expect(createServerClient).toHaveBeenCalledWith(
        'https://test-url.supabase.co',
        'test-anon-key',
        expect.objectContaining({
          cookies: expect.objectContaining({
            getAll: expect.any(Function),
            setAll: expect.any(Function),
          }),
        })
      );
    });
  });

  it('should properly proxy cookie.getAll', () => {
    jest.isolateModules(() => {
      const { createClient } = require('./server');
      const mockCookieStore = {
        getAll: jest.fn().mockReturnValue([{ name: 'test', value: 'value' }]),
        setAll: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        has: jest.fn(),
        clear: jest.fn(),
      } as any;

      createClient(mockCookieStore);

      const clientOptions = (createServerClient as jest.Mock).mock.calls[0][2];

      const result = clientOptions.cookies.getAll();

      expect(mockCookieStore.getAll).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ name: 'test', value: 'value' }]);
    });
  });

  it('should properly proxy cookie.setAll', () => {
    jest.isolateModules(() => {
      const { createClient } = require('./server');
      const mockCookieStore = {
        getAll: jest.fn(),
        setAll: jest.fn(),
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        has: jest.fn(),
        clear: jest.fn(),
      } as any;

      createClient(mockCookieStore);

      const clientOptions = (createServerClient as jest.Mock).mock.calls[0][2];

      const cookiesToSet = [
        { name: 'cookie1', value: 'value1', options: { secure: true } },
        { name: 'cookie2', value: 'value2', options: { httpOnly: true } },
      ];

      clientOptions.cookies.setAll(cookiesToSet);

      expect(mockCookieStore.set).toHaveBeenCalledTimes(2);
      expect(mockCookieStore.set).toHaveBeenNthCalledWith(1, 'cookie1', 'value1', { secure: true });
      expect(mockCookieStore.set).toHaveBeenNthCalledWith(2, 'cookie2', 'value2', { httpOnly: true });
    });
  });

  it('should ignore errors when cookie.setAll fails (Server Component boundary)', () => {
    jest.isolateModules(() => {
      const { createClient } = require('./server');
      const mockCookieStore = {
        getAll: jest.fn(),
        setAll: jest.fn(),
        get: jest.fn(),
        set: jest.fn().mockImplementation(() => {
          throw new Error('Cannot set cookies from Server Component');
        }),
        delete: jest.fn(),
        has: jest.fn(),
        clear: jest.fn(),
      } as any;

      createClient(mockCookieStore);

      const clientOptions = (createServerClient as jest.Mock).mock.calls[0][2];

      const cookiesToSet = [
        { name: 'cookie1', value: 'value1', options: {} },
      ];

      expect(() => {
        clientOptions.cookies.setAll(cookiesToSet);
      }).not.toThrow();

      expect(mockCookieStore.set).toHaveBeenCalledTimes(1);
    });
  });

  it('should use NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY if ANON_KEY is not set', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';

    jest.isolateModules(() => {
      const { createClient } = require('./server');
      const mockCookieStore = {
        getAll: jest.fn(),
        set: jest.fn(),
      } as any;

      createClient(mockCookieStore);

      expect(createServerClient).toHaveBeenCalledWith(
        'https://test-url.supabase.co',
        'test-publishable-key',
        expect.any(Object)
      );
    });
  });
});
