import { createAppState } from './state.js';
import { mountApp } from './ui/app.js';
import './style.css';

const root = document.getElementById('app');
const app = createAppState();

mountApp(root, app);
app.loadPersisted();
