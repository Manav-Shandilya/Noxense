import { useState, useRef, useEffect } from 'react';
import { login } from '../services/api';

async function hashPin(pin) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const PIN_LENGTH = 4;

export function PinDots({ length, filled, error }) {
  return (
    <div className={`pin-dots${error ? ' pin-shake' : ''}`}>
      {Array.from({ length }, (_, i) => (
        <div
          key={i}
          className={`pin-dot${i < filled ? ' filled' : ''}`}
        />
      ))}
    </div>
  );
}

export function PinKeypad({ onDigit, onDelete, disabled }) {
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, null, 0, 'del'];
  return (
    <div className="pin-keypad">
      {keys.map((key, i) => {
        if (key === null) return <div key={i} className="keypad-spacer" />;
        if (key === 'del') {
          return (
            <button
              key={i}
              type="button"
              className="keypad-btn keypad-delete"
              onClick={onDelete}
              disabled={disabled}
              aria-label="Delete"
            >
              ⌫
            </button>
          );
        }
        return (
          <button
            key={i}
            type="button"
            className="keypad-btn"
            onClick={() => onDigit(key)}
            disabled={disabled}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}

export default function LoginScreen({ onLogin, onLogout }) {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  const isFirstTime = !localStorage.getItem('pin_hash');
  const [step, setStep] = useState(isFirstTime ? 'setup' : 'login');
  const [setupPhase, setSetupPhase] = useState('enter'); // 'enter' or 'confirm'

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  function handleDigit(digit) {
    if (step === 'setup') {
      if (setupPhase === 'enter') {
        const next = pin + digit;
        setPin(next);
        setError('');
        if (next.length === PIN_LENGTH) {
          setTimeout(() => setSetupPhase('confirm'), 200);
        }
      } else {
        const next = confirmPin + digit;
        setConfirmPin(next);
        setError('');
        if (next.length === PIN_LENGTH) {
          setTimeout(() => submitSetup(pin, next), 200);
        }
      }
    } else {
      const next = pin + digit;
      setPin(next);
      setError('');
      if (next.length === PIN_LENGTH) {
        setTimeout(() => submitLogin(next), 200);
      }
    }
  }

  function handleDelete() {
    if (step === 'setup' && setupPhase === 'confirm') {
      setConfirmPin((p) => p.slice(0, -1));
    } else {
      setPin((p) => p.slice(0, -1));
    }
    setError('');
  }

  async function submitSetup(enteredPin, confirmed) {
    if (enteredPin !== confirmed) {
      setError('PINs do not match');
      setConfirmPin('');
      setSetupPhase('confirm');
      triggerShake();
      return;
    }

    setLoading(true);
    setError('');

    try {
      await login(enteredPin);
      const hash = await hashPin(enteredPin);
      localStorage.setItem('pin_hash', hash);
      onLogin();
    } catch {
      try {
        const hash = await hashPin(enteredPin);
        localStorage.setItem('pin_hash', hash);
        // Restore session from persistent token
        const persistentToken = localStorage.getItem('token');
        if (persistentToken) {
          sessionStorage.setItem('token', persistentToken);
        }
        onLogin();
      } catch {
        setError('Something went wrong');
        triggerShake();
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitLogin(enteredPin) {
    setLoading(true);
    setError('');

    try {
      await login(enteredPin);
      const hash = await hashPin(enteredPin);
      localStorage.setItem('pin_hash', hash);
      onLogin();
    } catch {
      const storedHash = localStorage.getItem('pin_hash');
      if (storedHash) {
        const hash = await hashPin(enteredPin);
        if (hash === storedHash) {
          // Local PIN verified — restore session from persistent token
          const persistentToken = localStorage.getItem('token');
          if (persistentToken) {
            sessionStorage.setItem('token', persistentToken);
          }
          onLogin();
          return;
        }
      }
      setError('Wrong PIN');
      setPin('');
      triggerShake();
    } finally {
      setLoading(false);
    }
  }

  const currentFilled = step === 'setup' && setupPhase === 'confirm'
    ? confirmPin.length
    : pin.length;

  const subtitle = step === 'setup'
    ? (setupPhase === 'enter' ? 'Create your PIN' : 'Confirm your PIN')
    : 'Enter PIN to unlock';

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

        <p className="login-subtitle">{subtitle}</p>

        <PinDots length={PIN_LENGTH} filled={currentFilled} error={shake} />

        {error && <p className="login-error">{error}</p>}
        {loading && <p className="login-loading">Verifying...</p>}

        <PinKeypad
          onDigit={handleDigit}
          onDelete={handleDelete}
          disabled={loading}
        />

        {onLogout && (
          <p className="auth-switch" style={{ marginTop: '1.5rem' }}>
            <button type="button" className="auth-switch-btn" onClick={onLogout}>
              Switch Account
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
