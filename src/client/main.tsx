import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './style.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing React root element');
}

// @ts-ignore
window.__PW_ACTIVE__ = true;

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
