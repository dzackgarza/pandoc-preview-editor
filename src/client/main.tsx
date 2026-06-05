import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './style.css';

declare global {
  interface Window {
    __PW_ACTIVE__: boolean;
  }
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing React root element');
}

window.__PW_ACTIVE__ = true;

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
