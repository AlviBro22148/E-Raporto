import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Spinner } from '../components/ui';
import logoEmblem from '../assets/logo-emblem.png';

/**
 * Eye glyph for the password reveal toggle. Inline rather than from an icon package: this is the
 * only icon the dashboard needs, and the struck-through variant is what carries the on/off state, so
 * it never rests on colour alone.
 */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12Z" />
      <circle cx="12" cy="12" r="2.9" />
      {off && <line x1="3.4" y1="20.6" x2="20.6" y2="3.4" />}
    </svg>
  );
}

export function LoginPage() {
  const { user, loading, login } = useAuth();
  const [email, setEmail] = useState('admin@elbasan.gov.al');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return <Spinner label="Duke verifikuar sesionin…" />;
  if (user) return <Navigate to="/reports" replace />;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hyrja dështoi.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
      {/* Left panel doubles as pitch surface — the jury sees this screen before anything else. */}
      <div
        style={{
          background: 'linear-gradient(150deg, var(--brand-900), var(--brand-700) 62%, #1d4e89)',
          color: '#e8eef6',
          padding: '56px 52px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div className="row" style={{ gap: 14, alignItems: 'center' }}>
          <img
            src={logoEmblem}
            alt=""
            aria-hidden="true"
            style={{ width: 56, height: 56, flex: 'none', objectFit: 'contain' }}
          />
          <div>
            <div style={{ fontSize: 17, fontWeight: 680 }}>E-Raporto</div>
            <div style={{ fontSize: 11, color: '#93a7c0', letterSpacing: '0.05em' }}>BASHKIA ELBASAN</div>
          </div>
        </div>

        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 30, lineHeight: 1.25, marginBottom: 16, color: '#fff' }}>
            Një kanal i vetëm për çdo problem të qytetit.
          </h1>
          <p style={{ fontSize: 14.5, color: '#b6c4d6', lineHeight: 1.65 }}>
            Raportet e qytetarëve mbërrijnë të kategorizuara, të drejtuara te drejtoria përgjegjëse dhe
            të kontrolluara për dublikime — para se dikush t'i shohë. Ju vendosni; sistemi vetëm përgatit.
          </p>
        </div>

        <div style={{ fontSize: 12, color: '#8fa3bd', lineHeight: 1.7 }}>
          
        </div>
      </div>

      <div style={{ display: 'grid', placeItems: 'center', padding: 32, background: 'var(--bg)' }}>
        <form onSubmit={handleSubmit} className="card card-pad" style={{ width: '100%', maxWidth: 380, padding: 28 }}>
          <h2 style={{ fontSize: 20, marginBottom: 6 }}>Hyrje për stafin</h2>
          <p className="muted" style={{ fontSize: 13, marginBottom: 22 }}>
            Paneli i menaxhimit të raporteve.
          </p>

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email" className="input" type="email" required autoComplete="username"
              value={email} onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div style={{ marginBottom: 18 }}>
            <label className="label" htmlFor="password">Fjalëkalimi</label>
            <div className="password-field">
              <input
                id="password" className="input" type={passwordVisible ? 'text' : 'password'}
                required autoComplete="current-password"
                value={password} onChange={e => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setPasswordVisible(v => !v)}
                aria-pressed={passwordVisible}
                aria-label={passwordVisible ? 'Fshih fjalëkalimin' : 'Shfaq fjalëkalimin'}
                title={passwordVisible ? 'Fshih fjalëkalimin' : 'Shfaq fjalëkalimin'}
              >
                <EyeIcon off={!passwordVisible} />
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                marginBottom: 14, padding: '9px 12px', borderRadius: 'var(--radius-sm)',
                background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                border: '1px solid color-mix(in srgb, var(--danger) 32%, transparent)',
                color: 'var(--danger)', fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? <span className="spinner" style={{ width: 15, height: 15 }} /> : 'Hyr'}
          </button>

          <div
            className="muted"
            style={{
              marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--border)',
              fontSize: 11.5, lineHeight: 1.6,
            }}
          >
            <strong style={{ color: 'var(--ink-2)' }}>Llogari demo</strong><br />
            admin@elbasan.gov.al · <span className="mono">Elbasan2026!</span>
          </div>
        </form>
      </div>
    </div>
  );
}
