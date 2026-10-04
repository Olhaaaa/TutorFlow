import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tokens.css';
import './features/calendar/calendar.css';
import './shell.css';
import { App } from './App.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
