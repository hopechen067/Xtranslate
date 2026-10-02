'use strict';

const { fail } = require('../errors');

/**
 * 带超时的 fetch。用户取消和超时分开标记，避免把取消说成断网。
 */
async function fetchWithTimeout(url, options, { timeoutMs, service, fetchImpl }) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw fail('NETWORK', { service, message: 'no fetch' });
  }
  const userSignal = options && options.signal;
  if (userSignal && userSignal.aborted) throw fail('CANCEL', { service });

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);

  const onUserAbort = () => ctrl.abort();
  if (userSignal) userSignal.addEventListener('abort', onUserAbort, { once: true });

  try {
    return await fetchFn(url, { ...options, signal: ctrl.signal });
  } catch (err) {
    if (timedOut) throw fail('TIMEOUT', { service });
    if (userSignal && userSignal.aborted) throw fail('CANCEL', { service });
    throw fail('NETWORK', { service, cause: err });
  } finally {
    clearTimeout(timer);
    if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
  }
}

function httpFail(status, service) {
  return fail('HTTP', { status, service });
}

module.exports = { fetchWithTimeout, httpFail };
