import { useState, useEffect, useCallback } from 'react';
import LoginScreen from './components/LoginScreen';
import Dashboard from './components/Dashboard';
import TransactionList from './components/TransactionList';
import TransactionForm from './components/TransactionForm';
import CategoryManager from './components/CategoryManager';
import AccountManager from './components/AccountManager';
import BudgetSettings from './components/BudgetSettings';
import { isOnline, onConnectivityChange, replay, pendingCount } from './services/offlineQueue';
import SignUpScreen from './components/SignUpScreen';
import EmailLoginScreen from './components/EmailLoginScreen';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'transactions', label: 'Transactions', icon: '📋' },
  { id: 'categories', label: 'Categories', icon: '🏷️' },
  { id: 'accounts', label: 'Accounts', icon: '🏦' },
  { id: 'budget', label: 'Budget', icon: '💰' },
];

function isLoggedIn() {
  return !!sessionStorage.getItem('token');
}

function hasAccount() {
  return !!localStorage.getItem('token');
}

function getCurrentMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(isLoggedIn());
  const [authScreen, setAuthScreen] = useState(hasAccount() ? 'pin' : 'signup');
  const [online, setOnline] = useState(isOnline());
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [refreshKey, setRefreshKey] = useState(0);
  const [txnMonth, setTxnMonth] = useState(getCurrentMonth);

  // Transaction form modal state
  const [showTxnForm, setShowTxnForm] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [fabVisible, setFabVisible] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Hide FAB on scroll down, show on scroll to top
  useEffect(() => {
    let lastScrollY = 0;
    function handleScroll() {
      const currentScrollY = window.scrollY;
      if (currentScrollY <= 50) {
        setFabVisible(true);
      } else if (currentScrollY > lastScrollY) {
        setFabVisible(false);
      } else {
        setFabVisible(true);
      }
      lastScrollY = currentScrollY;
    }
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const cleanup = onConnectivityChange(async (isNowOnline) => {
      setOnline(isNowOnline);
      if (isNowOnline) {
        const count = await pendingCount();
        if (count > 0) {
          setSyncing(true);
          await replay();
          setSyncing(false);
          triggerRefresh();
        }
      }
    });
    return cleanup;
  }, [triggerRefresh]);

  // Lock the app when it becomes hidden (user switches away) and require PIN on return
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        sessionStorage.removeItem('token');
      } else if (document.visibilityState === 'visible') {
        if (!sessionStorage.getItem('token')) {
          setAuthenticated(false);
        }
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  function handleLogin() {
    setAuthenticated(true);
  }

  // Called after email login/signup succeeds — stores persistent token
  function handleEmailAuth() {
    // Token is already in sessionStorage from api.js login call
    // Copy to localStorage so we know this device has an account
    const token = sessionStorage.getItem('token');
    if (token) {
      localStorage.setItem('token', token);
    }
    setAuthenticated(true);
  }

  function handleLogout() {
    handleFullLogout();
    setAuthenticated(false);
  }

  function handleAddTransaction() {
    setEditingTransaction(null);
    setShowTxnForm(true);
  }

  function handleEditTransaction(txn) {
    setEditingTransaction(txn);
    setShowTxnForm(true);
  }

  function handleTxnFormClose() {
    setShowTxnForm(false);
    setEditingTransaction(null);
  }

  function handleTxnSaved() {
    triggerRefresh();
  }

  function handleCategoryChange() {
    triggerRefresh();
  }

  function handleBudgetChange() {
    triggerRefresh();
  }

  function handleFullLogout() {
    sessionStorage.removeItem('token');
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('pin_hash');
    setAuthenticated(false);
    setAuthScreen('signup');
  }

  function onSwitchToLogin(){
    setAuthScreen('login');
  }

  function onSwitchToSignup(){
    setAuthScreen('signup');
  }

  if (!authenticated) {
    // Returning user with stored token → show PIN screen
    if (authScreen === 'pin' && hasAccount()) {
      return <LoginScreen onLogin={handleLogin} onLogout={handleFullLogout} />;
    }
    // Email login screen
    if (authScreen === 'login') {
      return <EmailLoginScreen onLogin={handleEmailAuth} onSwitchToSignup={onSwitchToSignup} />;
    }
    // Signup screen (first time)
    return <SignUpScreen onSwitchToLogin={onSwitchToLogin} onSignUp={handleEmailAuth} />;
  }

  return (
    <div className="app-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`sidebar-btn${activeTab === tab.id ? ' active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              aria-label={tab.label}
              title={tab.label}
            >
              <span className="sidebar-icon">{tab.icon}</span>
              <span className="sidebar-label">{tab.label}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main content area */}
      <div className="main-wrapper">
        {!online && (
          <div className="offline-banner" role="alert">
            You are offline. Changes will sync when connection is restored.
          </div>
        )}
        {syncing && (
          <div className="sync-banner" role="status">
            Syncing offline changes…
          </div>
        )}

        {/* Top Header */}
        <header className="top-header">
          <div className="header-left">
            <div className="logo">
              <img src="/icons/Noxense_Logo.png" height={20} width={20} alt="Noxense" className="logo-img" />
              <span className="logo-text">Noxense</span>
            </div>
          </div>
          <nav className="header-nav" role="tablist" aria-label="Main navigation">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`header-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="header-right">
            {/* <button className="notification-bell" aria-label="Notifications">
              🔔
              <span className="notification-badge">2</span>
            </button> */}
            <div className="user-menu-wrapper">
              <button className="user-menu-trigger" onClick={() => setShowUserMenu(!showUserMenu)}>
                <span className="avatar-circle">👤</span>
                <span className="dropdown-chevron">{showUserMenu ? '‹' : '›'}</span>
              </button>
              {showUserMenu && (
                <div className="user-menu-dropdown">
                  <button className="user-menu-item" onClick={() => { setShowUserMenu(false); handleLogout(); }}>
                    Logout
                  </button>
                </div>
              )}
            </div>
            <button className="logout-btn desktop-only" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="page-content" role="tabpanel">
          {activeTab === 'dashboard' && (
            <Dashboard key={refreshKey} onAddTransaction={handleAddTransaction} />
          )}
          {activeTab === 'transactions' && (
            <>
              <div className="month-selector">
                <button
                  className="month-nav-btn"
                  onClick={() => setTxnMonth((prev) => prev.month === 1 ? { month: 12, year: prev.year - 1 } : { month: prev.month - 1, year: prev.year })}
                  aria-label="Previous month"
                >
                  &#8249;
                </button>
                <span className="month-label">
                  {new Date(txnMonth.year, txnMonth.month - 1).toLocaleString('default', { month: 'long', year: 'numeric' })}
                </span>
                <button
                  className="month-nav-btn"
                  onClick={() => setTxnMonth((prev) => prev.month === 12 ? { month: 1, year: prev.year + 1 } : { month: prev.month + 1, year: prev.year })}
                  aria-label="Next month"
                >
                  &#8250;
                </button>
              </div>
              <TransactionList
                month={txnMonth.month}
                year={txnMonth.year}
                onEdit={handleEditTransaction}
                onDeleted={triggerRefresh}
                refreshKey={refreshKey}
              />
            </>
          )}
          {activeTab === 'categories' && (
            <CategoryManager onChanged={handleCategoryChange} />
          )}
          {activeTab === 'accounts' && (
            <AccountManager onChanged={triggerRefresh} />
          )}
          {activeTab === 'budget' && (
            <BudgetSettings onChanged={handleBudgetChange} />
          )}
        </main>

        {/* Floating Add Transaction Button - only on transactions and dashboard */}
        {(activeTab === 'transactions') && (
          <button
            className={`fab-add-transaction${fabVisible ? '' : ' fab-hidden'}`}
            onClick={handleAddTransaction}
            aria-label="Add Transaction"
          >
            <span className="fab-text">+ Add Transaction</span>
            <span className="fab-icon">+</span>
          </button>
        )}
      </div>

      {/* Bottom Navigation for Mobile */}
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`bottom-nav-btn${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            aria-label={tab.label}
          >
            <span className="bottom-nav-icon">{tab.icon}</span>
            <span className="bottom-nav-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      {showTxnForm && (
        <TransactionForm
          transaction={editingTransaction}
          onClose={handleTxnFormClose}
          onSaved={handleTxnSaved}
        />
      )}
    </div>
  );
}
