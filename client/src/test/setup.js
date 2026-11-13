import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

if (!window.matchMedia) {
  window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
// Radix primitives rely on these in jsdom.
window.HTMLElement.prototype.scrollIntoView ||= vi.fn();
window.HTMLElement.prototype.hasPointerCapture ||= vi.fn(() => false);
window.HTMLElement.prototype.releasePointerCapture ||= vi.fn();
globalThis.ResizeObserver ||= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
