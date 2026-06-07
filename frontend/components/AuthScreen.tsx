'use client';

import { FormEvent, useState } from 'react';
import { BrainCircuit, Loader2, Lock, Mail } from 'lucide-react';
import { passwordAuthEnabled, supabase, supabaseConfigured } from '@/lib/supabase';

export default function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'magic' | 'password'>('magic');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === 'password') {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) throw error;
      setMessage('Check your email for the sign-in link.');
    } catch (err: any) {
      setError(err.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 text-ink">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-5 flex items-center gap-2">
          <BrainCircuit className="h-6 w-6 text-brand" />
          <div>
            <h1 className="text-sm font-semibold">Executive Intelligence Assistant</h1>
            <p className="text-xs text-slate-500">Sign in to your document workspace</p>
          </div>
        </div>

        {!supabaseConfigured && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Supabase browser env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and
            NEXT_PUBLIC_SUPABASE_ANON_KEY.
          </p>
        )}

        {passwordAuthEnabled && (
          <div className="mb-4 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode('magic')}
              className={`rounded-md px-3 py-1.5 ${
                mode === 'magic' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'
              }`}
            >
              Magic link
            </button>
            <button
              type="button"
              onClick={() => setMode('password')}
              className={`rounded-md px-3 py-1.5 ${
                mode === 'password' ? 'bg-white font-semibold shadow-sm' : 'text-slate-500'
              }`}
            >
              Test login
            </button>
          </div>
        )}

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Email</span>
          <span className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-brand">
            <Mail className="h-4 w-4 text-slate-400" />
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              placeholder="you@example.com"
            />
          </span>
        </label>

        {mode === 'password' && (
          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Password</span>
            <span className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 focus-within:border-brand">
              <Lock className="h-4 w-4 text-slate-400" />
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </span>
          </label>
        )}

        <button
          type="submit"
          disabled={busy || !supabaseConfigured}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-soft disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'password' ? 'Sign in' : 'Send magic link'}
        </button>

        {message && <p className="mt-3 text-xs text-emerald-700">{message}</p>}
        {error && <p className="mt-3 text-xs text-rose-700">{error}</p>}
      </form>
    </main>
  );
}
