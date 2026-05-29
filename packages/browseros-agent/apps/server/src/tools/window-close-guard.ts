/**
 * window.close() guard for evaluate_script.
 *
 * Defense-in-depth: wraps JavaScript expressions with a preamble that
 * temporarily overrides `window.close()` with a no-op that logs a warning.
 * The original function is restored after the expression executes.
 *
 * This prevents an LLM from accidentally closing the browser by running
 * `window.close()` through the evaluate_script tool.
 */

/**
 * The preamble injected before the user's expression.
 * Saves the original window.close, overrides it with a safe no-op,
 * and ensures restoration via try/finally.
 */
export const WINDOW_CLOSE_GUARD_PREAMBLE = `(function() {
  const _origClose = window.close;
  Object.defineProperty(window, 'close', {
    value: function() { console.warn('[BrowserOS] window.close() blocked — use close_page tool instead'); },
    configurable: true,
    writable: true
  });
  try {
    return (` as const

const WINDOW_CLOSE_GUARD_POSTAMBLE = `);
  } finally {
    Object.defineProperty(window, 'close', {
      value: _origClose,
      configurable: true,
      writable: true
    });
  }
})()`

/**
 * Wrap a JavaScript expression with the window.close() guard.
 * The expression is evaluated inside a try/finally block that:
 * 1. Saves the original window.close
 * 2. Overrides it with a no-op
 * 3. Evaluates the expression
 * 4. Restores the original window.close
 *
 * @param expression - The JavaScript expression to wrap
 * @returns The wrapped expression
 */
export function wrapWithWindowCloseGuard(expression: string): string {
  return `${WINDOW_CLOSE_GUARD_PREAMBLE}${expression}${WINDOW_CLOSE_GUARD_POSTAMBLE}`
}
