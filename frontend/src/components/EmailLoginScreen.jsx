import { useState } from 'react';
import { loginWithEmail } from '../services/api';

export default function EmailLoginScreen({ onLogin, onSwitchToSignup }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    setLoading(true);
    try {
      await loginWithEmail(email, password);
      onLogin();
    } catch (err) {
      setError('Invalid credentials. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-glow" />
      <div className="login-card">
        <div className="login-logo">
          <img src="/icons/Noxense_Logo.png" alt="Noxense" className="login-logo-img" />
        </div>
        <h1 className="login-brand">Noxense</h1>
        <p className="login-tagline">Your finances, secured.</p>

        <div className="login-divider" />

        <p className="login-subtitle">Log in to your account</p>

        <form className="signup-form" onSubmit={handleSubmit} noValidate>
          <div className="auth-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="auth-field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="auth-submit-btn" disabled={loading}>
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>

        {onSwitchToSignup && (
          <p className="auth-switch">
            Don't have an account?{' '}
            <button type="button" className="auth-switch-btn" onClick={onSwitchToSignup}>
              Sign up
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
