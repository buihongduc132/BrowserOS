/**
 * window.close() guard for evaluate_script.
 *
 * Defense-in-depth: wraps JavaScript expressions with a preamble that
 * temporarily overrides `window.close()` with a no-op that logs a warning.
 * The original function is restored after the expression executes.
 *
 * This prevents an LLM from accidentally closing the browser by running
 * `window.close()` through the evaluate_script tool.
 *
 * Supports both single expressions and multi-statement inputs.
 * Uses eval() inside the IIFE so statements like `const x = 1` work.
 */

/**
 * The preamble injected before the user's expression.
 * Saves the original window.close, overrides it with a safe no-op,
 * and ensures restoration via try/finally.
 * Uses eval() to support both expressions and multi-statement code.
 */
export const WINDOW_CLOSE_GUARD_PREAMBLE = `(function() {
  const _bOsWcOrig = window.close;
  Object.defineProperty(window, 'close', {
    value: function() { console.warn('[BrowserOS] window.close() blocked — use close_page tool instead'); },
    configurable: true,
    writable: true
  });
  try {
    return eval(` as const

const WINDOW_CLOSE_GUARD_POSTAMBLE = `);
  } finally {
    Object.defineProperty(window, 'close', {
      value: _bOsWcOrig,
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
 * 3. Evaluates the expression via eval() (supports statements + expressions)
 * 4. Restores the original window.close
 *
 * @param expression - The JavaScript expression or statements to wrap
 * @returns The wrapped expression
 */
export function wrapWithWindowCloseGuard(expression: string): string {
  return `${WINDOW_CLOSE_GUARD_PREAMBLE}${JSON.stringify(expression)}${WINDOW_CLOSE_GUARD_POSTAMBLE}`
}
