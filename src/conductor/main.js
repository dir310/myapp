/**
 * Conductor page entry point — wires all modules together.
 */
import '../styles/common.css';
import '../styles/conductor.css';

import { toggleRadar } from './ui.js';
import { loadViajes, setupRealtimeChannel } from './realtime.js';

// ── Event Listeners ──
document.getElementById('radarBtn').addEventListener('click', toggleRadar);

// ── Initialize ──
loadViajes();
setupRealtimeChannel();
