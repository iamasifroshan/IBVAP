import React from 'react';
import { AppProvider } from './context/AppContext';
import { AppLayout } from './components/layout/AppLayout';

export function App() {
  return (
    <AppProvider>
      <AppLayout />
    </AppProvider>
  );
}

export default App;
