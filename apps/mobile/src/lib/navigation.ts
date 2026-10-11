import type { Href, useRouter } from 'expo-router';

type Router = ReturnType<typeof useRouter>;

/**
 * Back, or somewhere sensible when there is nothing to go back to.
 *
 * A screen opened from a link, a notification or after a reload is the first
 * one in its stack, and `router.back()` there is a no-op that logs an
 * unhandled GO_BACK error. This falls back to Home (or the given route).
 */
export function goBack(router: Router, fallback: Href = '/(tabs)'): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
