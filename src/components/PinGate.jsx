import { useState, useEffect, useRef } from 'react';
import { Lock, Loader2 } from 'lucide-react';

// SHA-256 of "3700". The plaintext PIN is never embedded in the bundle —
// the gate only knows the digest and compares against hash(user-input).
// Computed once with `echo -n "3700" | shasum -a 256`.
const PIN_HASH = '7a00c776e0af1135c9b8397dd66f449e84466d3772d14301b110576ff7461116';
const PIN_LENGTH = 4;
const SESSION_KEY = 'selric.accountant-pin-ok';

async function sha256Hex(input) {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Soft gate. RLS is still the real protection — this just slows down a
// curious browser. Resets when the tab closes (sessionStorage).
export default function PinGate({ children, label = 'Accountant' }) {
  const [ok, setOk]       = useState(() => sessionStorage.getItem(SESSION_KEY) === '1');
  const [pin, setPin]     = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy]   = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef          = useRef(null);

  useEffect(() => {
    if (!ok) {
      const id = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(id);
    }
  }, [ok]);

  async function submit(e) {
    e?.preventDefault?.();
    if (pin.length !== PIN_LENGTH) return;
    setBusy(true);
    setError('');
    try {
      const hash = await sha256Hex(pin);
      if (hash === PIN_HASH) {
        sessionStorage.setItem(SESSION_KEY, '1');
        setOk(true);
        return;
      }
      setError('Incorrect PIN');
      setShake(true);
      setTimeout(() => setShake(false), 450);
      setPin('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  if (ok) return children;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-surface-900/85 backdrop-blur-sm p-4">
      <style>{`
        @keyframes pin-shake { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-6px); } 40%,80% { transform: translateX(6px); } }
        .pin-shake { animation: pin-shake 0.4s ease-in-out; }
      `}</style>

      <form
        onSubmit={submit}
        className={`bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 ${shake ? 'pin-shake' : ''}`}
        style={{ borderTop: '4px solid #276e52' }}
      >
        <div className="flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3" style={{ backgroundColor: '#276e52' }}>
            <Lock size={20} className="text-white" />
          </div>
          <h2 className="font-display text-xl" style={{ color: '#276e52' }}>{label}</h2>
          <p className="text-xs text-surface-500 mt-1">Enter the 4-digit PIN to continue</p>
        </div>

        <div className="mt-5">
          <input
            ref={inputRef}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
            inputMode="numeric"
            autoComplete="off"
            type="password"
            maxLength={PIN_LENGTH}
            placeholder="••••"
            className="w-full text-center text-2xl font-mono tracking-[0.6em] py-3 rounded-lg border-2 border-surface-200 focus:outline-none focus:border-brand-600 transition"
          />
          {error && (
            <div className="mt-2 text-center text-xs font-medium text-red-600">{error}</div>
          )}
        </div>

        <button
          type="submit"
          disabled={pin.length !== PIN_LENGTH || busy}
          className="mt-5 w-full py-3 rounded-lg text-white font-semibold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: '#276e52' }}
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          Unlock
        </button>

        <div className="mt-4 text-[10px] text-surface-400 text-center">
          Soft gate · RLS still enforces admin-only access
        </div>
      </form>
    </div>
  );
}
