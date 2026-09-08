import { useCallback, useEffect, useRef, useState } from 'react';

// Auto-fading chrome (issue #18, SPEC §6.7). The toolbars fade after a few
// seconds of stillness and any interaction brings them back — immersion by
// subtraction, without ever moving the page (the fade is opacity-only, so the
// reading viewport and its band layout are untouched).
//
// `locked` holds the chrome visible regardless of the timer — while a panel or
// menu is open, or the pointer is resting on the chrome — so it never fades out
// from under something the reader is using.
const IDLE_MS = 3000;

export function useChromeFade(locked: boolean): { visible: boolean; poke: () => void } {
  const [visible, setVisible] = useState(true);
  // Last interaction time, in a ref so pointer-move spam doesn't re-render — only
  // the visible/hidden transition does.
  const lastActive = useRef(Date.now());

  const poke = useCallback(() => {
    lastActive.current = Date.now();
    setVisible(true);
  }, []);

  // Any interaction anywhere counts as activity. Passive listeners so scrolling
  // and moving stay smooth; keydown is non-passive only because other handlers
  // may preventDefault, not this one.
  useEffect(() => {
    const bump = () => poke();
    const passive = { passive: true } as AddEventListenerOptions;
    window.addEventListener('pointermove', bump, passive);
    window.addEventListener('pointerdown', bump, passive);
    window.addEventListener('wheel', bump, passive);
    window.addEventListener('touchstart', bump, passive);
    window.addEventListener('keydown', bump);
    return () => {
      window.removeEventListener('pointermove', bump);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('wheel', bump);
      window.removeEventListener('touchstart', bump);
      window.removeEventListener('keydown', bump);
    };
  }, [poke]);

  // While locked, pin the chrome visible and run no hide timer. Otherwise poll
  // for idleness and fade once the reader has been still past the threshold.
  useEffect(() => {
    if (locked) {
      setVisible(true);
      return;
    }
    const id = window.setInterval(() => {
      if (Date.now() - lastActive.current >= IDLE_MS) setVisible(false);
    }, 500);
    return () => window.clearInterval(id);
  }, [locked]);

  return { visible, poke };
}
