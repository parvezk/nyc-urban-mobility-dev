import { normalizeSupabaseUrl, getSupabaseCredentials } from './supabase-credentials';

describe('Supabase Credentials', () => {
  describe('normalizeSupabaseUrl', () => {
    it('returns basic URL unmodified', () => {
      expect(normalizeSupabaseUrl('https://example.supabase.co')).toBe('https://example.supabase.co');
    });

    it('removes trailing slashes', () => {
      expect(normalizeSupabaseUrl('https://example.supabase.co/')).toBe('https://example.supabase.co');
      expect(normalizeSupabaseUrl('https://example.supabase.co///')).toBe('https://example.supabase.co');
    });

    it('removes surrounding whitespace', () => {
      expect(normalizeSupabaseUrl('  https://example.supabase.co  ')).toBe('https://example.supabase.co');
      expect(normalizeSupabaseUrl('  https://example.supabase.co/  ')).toBe('https://example.supabase.co');
    });
  });

  describe('getSupabaseCredentials', () => {
    it('extracts URL and uses SERVICE_ROLE_KEY if present', () => {
      const env = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      };

      const creds = getSupabaseCredentials(env);

      expect(creds.supabaseUrl).toBe('https://example.supabase.co');
      expect(creds.supabaseKey).toBe('service-role-key');
    });

    it('uses PUBLISHABLE_KEY if SERVICE_ROLE_KEY is absent', () => {
      const env = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      };

      const creds = getSupabaseCredentials(env);

      expect(creds.supabaseKey).toBe('publishable-key');
    });

    it('uses ANON_KEY if others are absent', () => {
      const env = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      };

      const creds = getSupabaseCredentials(env);

      expect(creds.supabaseKey).toBe('anon-key');
    });

    it('handles whitespace in environment variables', () => {
      const env = {
        NEXT_PUBLIC_SUPABASE_URL: '  https://example.supabase.co/  ',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: '  anon-key  ',
      };

      const creds = getSupabaseCredentials(env);

      expect(creds.supabaseUrl).toBe('https://example.supabase.co');
      expect(creds.supabaseKey).toBe('anon-key');
    });

    it('skips empty whitespace-only keys and falls back to next valid key', () => {
      const env = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: '   ',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '  \n  ',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      };

      const creds = getSupabaseCredentials(env);

      expect(creds.supabaseKey).toBe('anon-key');
    });

    it('throws if URL is missing', () => {
      const env = {
        NEXT_PUBLIC_SUPABASE_URL: '   ',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      };

      expect(() => getSupabaseCredentials(env)).toThrow('Missing Supabase credentials');
    });

    it('throws if no valid key is present', () => {
      const env = {
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: '',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: '   ',
      };

      expect(() => getSupabaseCredentials(env)).toThrow('Missing Supabase credentials');
    });
  });
});
