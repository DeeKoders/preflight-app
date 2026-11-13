import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && media?.matches);
  document.documentElement.classList.toggle('dark', Boolean(dark));
}

/** The only genuinely global client state: the colour theme preference. */
export const useThemeStore = create(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    { name: 'pf-theme' }
  )
);

media?.addEventListener?.('change', () => applyTheme(useThemeStore.getState().theme));
