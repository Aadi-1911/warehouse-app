import { useEffect, useRef } from 'react';

// Calls `onIdle` after `timeoutMs` of no user activity. Investigated before writing: nothing like
// this existed anywhere in this frontend — the only prior setTimeout uses are one-shot "clear a
// success message after 1.5s" timers (Locations' profit-share save, Parties' GSTIN copy), which
// is a different shape entirely (fire once, no reset, no activity tracking).
//
// WHY A REF FOR THE CALLBACK: the timer must NOT restart every time the caller re-renders with a
// new inline `onIdle` closure. Putting `onIdle` in the effect's dependency array would reset the
// countdown on every parent render — and a dashboard page re-renders constantly (data loads,
// hover states, period toggles), so the idle timeout would in practice never fire at all. The ref
// lets the effect depend only on the things that genuinely define the timer (enabled, timeoutMs)
// while still always calling the LATEST callback.
//
// `enabled: false` tears the timer down entirely rather than leaving it running against a no-op —
// no point counting down to a re-lock while already locked.
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

export function useIdleTimer({ timeoutMs, onIdle, enabled = true, resetKey }) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled) return undefined;

    let timerId;
    const restart = () => {
      clearTimeout(timerId);
      timerId = setTimeout(() => onIdleRef.current(), timeoutMs);
    };

    // Passive listeners: none of these handlers call preventDefault, and telling the browser so
    // up front keeps scroll/touch handling off the main thread's critical path.
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, restart, { passive: true }));
    restart(); // start the first countdown immediately, not only after the first movement

    return () => {
      clearTimeout(timerId);
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, restart));
    };
    // `resetKey` is how a caller forces a fresh countdown on something that isn't a DOM event —
    // the dashboard passes the current route so navigation counts as activity (the task lists it
    // alongside mouse/keys), which a react-router <Link> click would otherwise only register via
    // its incidental mousedown.
  }, [enabled, timeoutMs, resetKey]);
}
