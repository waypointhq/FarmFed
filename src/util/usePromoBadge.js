import { useEffect, useState } from 'react';
import { fetchUnseenPromoCount } from './api';

// The topbar mounts on every page, so the count is reused for a minute
// rather than fetched on each navigation.
const CACHE_MS = 60 * 1000;
let cache = null;

/**
 * Forget the cached count, e.g. once the customer has seen their promos.
 */
export const clearPromoBadgeCache = () => {
  cache = null;
};

/**
 * How many gifted promos the customer hasn't looked at yet, for the dot on
 * the profile menu. Viewing My Promos (or the strip on the profile) clears it.
 *
 * @param {boolean} isAuthenticated
 * @returns {number}
 */
const usePromoBadge = isAuthenticated => {
  const [count, setCount] = useState(cache?.count || 0);

  useEffect(() => {
    if (!isAuthenticated) {
      setCount(0);
      return undefined;
    }
    if (cache && Date.now() - cache.at < CACHE_MS) {
      setCount(cache.count);
      return undefined;
    }
    let cancelled = false;
    fetchUnseenPromoCount()
      .then(res => {
        cache = { at: Date.now(), count: res?.count || 0 };
        if (!cancelled) setCount(cache.count);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  return count;
};

export default usePromoBadge;
