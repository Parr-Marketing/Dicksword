import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Login from './components/Login';
import MainApp from './components/MainApp';

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-container">
        <div style={{ color: 'var(--text-muted)', fontSize: 18 }}>Loading...</div>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <SocketProvider>
      <MainApp />
    </SocketProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
