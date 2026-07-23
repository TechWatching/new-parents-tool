import type { Page } from '@playwright/test'
import type { AppData } from '../../src/types'

/**
 * Seeds IndexedDB with the provided AppData and reloads the page so the app
 * starts with the data already present.
 *
 * The app uses `unstorage` with the `idb-keyval` backend configured as:
 *   - dbName:    'new-parents-tool'
 *   - storeName: 'bottle-feeds'
 *   - base:      'guest'
 *
 * This results in the key `guest:data` inside the `bottle-feeds` object store.
 *
 * @param page      - The Playwright page object.
 * @param data      - The AppData to seed.
 * @param frozenNow - Optional: freeze `Date.now()` / `new Date()` to this
 *                    timestamp for the entire page lifetime (persists across
 *                    reloads, since it is injected as an init script).
 *
 * Usage: call `await seedDatabase(page, data)` instead of `await page.goto('/')`.
 * The function navigates to `/`, writes to IndexedDB, then reloads the page.
 */
export async function seedDatabase(
  page: Page,
  data: AppData,
  frozenNow?: Date,
): Promise<void> {
  if (frozenNow) {
    // Inject a Date override that persists for every subsequent navigation
    // (addInitScript runs before any page script on each load/reload).
    const frozenMs = frozenNow.getTime()
    await page.addInitScript((time: number) => {
      const OriginalDate = window.Date
      class FrozenDate extends OriginalDate {
        constructor(...args: unknown[]) {
          super(time)
          if (args.length > 0) return Reflect.construct(OriginalDate, args) as FrozenDate
        }
        static now() {
          return time
        }
      }
      window.Date = FrozenDate as DateConstructor
    }, frozenMs)
  }

  // Navigate to the app and wait for it to fully load so that its initial
  // watch-triggered IDB save (which writes the empty/previously-loaded state)
  // has already been issued.  Writing our seed data after that point means our
  // write always arrives last and wins.
  await page.goto('/')
  await page.locator('.feed-card').waitFor({ state: 'visible', timeout: 10_000 })

  // Write the test data directly into IndexedDB.
  await page.evaluate((appData: AppData) => {
    return new Promise<void>((resolve, reject) => {
      const dbRequest = indexedDB.open('new-parents-tool')
      dbRequest.onupgradeneeded = (e: IDBVersionChangeEvent) => {
        const db = (e.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('bottle-feeds')) {
          db.createObjectStore('bottle-feeds')
        }
      }
      dbRequest.onsuccess = (e: Event) => {
        const db = (e.target as IDBOpenDBRequest).result
        const tx = db.transaction('bottle-feeds', 'readwrite')
        tx.objectStore('bottle-feeds').put(appData, 'guest:data')
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      }
      dbRequest.onerror = () => reject(dbRequest.error)
    })
  }, data)

  // Reload so the app initialises with the seeded data.
  await page.reload()
  // Wait for the app content to be rendered (the feed form is only visible after
  // the loading phase completes). This is more reliable than waiting for the
  // loading-overlay to be hidden, because the overlay may not exist in the DOM
  // before Vue has rendered the first frame.
  await page.locator('.feed-card').waitFor({ state: 'visible', timeout: 10_000 })
}

/**
 * Clears all entries from the app's IndexedDB store.
 * Useful in `afterEach` hooks to reset state between tests.
 */
export async function clearDatabase(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve, reject) => {
      const dbRequest = indexedDB.open('new-parents-tool')
      dbRequest.onsuccess = (e: Event) => {
        const db = (e.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('bottle-feeds')) {
          resolve()
          return
        }
        const tx = db.transaction('bottle-feeds', 'readwrite')
        const req = tx.objectStore('bottle-feeds').clear()
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error)
      }
      dbRequest.onerror = () => reject(dbRequest.error)
    })
  })
}
