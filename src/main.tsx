import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// If opened with ?detail= param, render a standalone event detail page
const detailParam = new URLSearchParams(window.location.search).get('detail');
if (detailParam) {
  try {
    const ev = JSON.parse(decodeURIComponent(detailParam));
    document.title = ev.title || 'Event Detail';
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <div style={{
          fontFamily: 'system-ui, sans-serif',
          background: '#f8f9fa',
          minHeight: '100vh',
          padding: '1rem',
          boxSizing: 'border-box',
          color: '#222',
        }}>
          <div style={{
            background: '#fff',
            borderRadius: 8,
            padding: '1.25rem',
            maxWidth: 600,
            margin: '0 auto',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            wordBreak: 'break-word',
            overflowWrap: 'break-word',
          }}>
            <h1 style={{ marginTop: 0, color: '#1976d2', fontSize: '1.3rem' }}>
              {ev.title}
            </h1>
            <div style={{ margin: '0.5rem 0' }}>
              <b>Room:</b> {ev.panelRoom}
            </div>
            <div style={{ margin: '0.5rem 0' }}>
              <b>Time:</b> {ev.start} - {ev.end}
            </div>
            <div style={{ margin: '0.5rem 0' }}>
              <b>Date:</b> {ev.date}
            </div>
            <div style={{ margin: '0.5rem 0' }}>
              <b>Ticket Required:</b> {ev.ticket
                ? <span style={{ color: '#e53935', fontWeight: 600 }}>Yes</span>
                : 'No'}
            </div>
            <div
              style={{ marginTop: '1rem', lineHeight: 1.6 }}
              dangerouslySetInnerHTML={{ __html: ev.panelDescription || '' }}
            />
            <button
              onClick={() => window.close()}
              style={{
                marginTop: 16,
                padding: '8px 16px',
                background: '#1976d2',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: '1rem',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </StrictMode>,
    );
  } catch {
    document.body.textContent = 'Invalid event data.';
  }
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register(
        import.meta.env.BASE_URL + 'sw.js',
        { scope: import.meta.env.BASE_URL }
      );
      // Check for updates when online
      if (navigator.onLine && reg.active) {
        reg.active.postMessage('check-update');
      }
      navigator.serviceWorker.ready.then((registration) => {
        if (navigator.onLine && registration.active) {
          registration.active.postMessage('check-update');
        }
      });
    } catch (e) {
      console.error('SW registration failed:', e);
    }
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'update-available') {
      console.log('App update available. Reload to update.');
    }
  });
}
