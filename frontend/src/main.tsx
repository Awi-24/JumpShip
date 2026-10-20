import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme } from './hooks/useTheme';
import { initDesktop } from './desktop';
import App from './App';

initTheme();
initDesktop();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
