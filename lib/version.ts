/**
 * Bumped when a release should invalidate the service worker's caches. It names the cache buckets,
 * so a new value orphans the old ones and `activate` deletes them.
 *
 * Used for support and debugging, not shown in the UI except on the settings page.
 */
export const APP_VERSION = "0.5.0"
