// Applies the saved colour theme before first paint (external file so a strict CSP can be used).
try {
  var t = (JSON.parse(localStorage.getItem('pf-theme') || '{}').state || {}).theme || 'system';
  var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
