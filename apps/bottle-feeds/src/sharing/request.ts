/** Bound stalled adapters without confusing network availability with local readiness. */
export function cloudRequest<T>(
  action: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  timeout = 25_000,
): Promise<T> {
  const controller = new AbortController()
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup()
      reject(new DOMException('Cloud request cancelled', 'AbortError'))
      controller.abort()
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Cloud request timed out. Your local changes are retained.'))
      controller.abort()
    }, timeout)
    const cleanup = () => {
      clearTimeout(timer)
      parentSignal?.removeEventListener('abort', abort)
    }
    if (parentSignal?.aborted) { cleanup(); abort(); return }
    parentSignal?.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => action(controller.signal)).then(resolve, reject).finally(cleanup)
  })
}
