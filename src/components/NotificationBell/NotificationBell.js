import React, { useState, useEffect, useRef, useCallback } from 'react';
import classNames from 'classnames';
import { useIntl } from '../../util/reactIntl';
import { fetchNotifications, markNotificationsRead } from '../../util/api';
import { registerPushToken, checkInjectedPushToken } from '../../util/pushNotifications';
import NamedLink from '../NamedLink/NamedLink';

import css from './NotificationBell.module.css';

const POLL_INTERVAL = 60000; // 1 minute

const NotificationBell = props => {
  const { className, rootClassName } = props;
  const intl = useIntl();
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const loadNotifications = useCallback(() => {
    fetchNotifications()
      .then(response => {
        setNotifications(response.notifications || []);
      })
      .catch(() => {
        // Silently fail — bell just shows 0
      });
  }, []);

  useEffect(() => {
    loadNotifications();
    const interval = setInterval(loadNotifications, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  // Register for push notifications when authenticated user mounts this component
  useEffect(() => {
    registerPushToken();
    checkInjectedPushToken();
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = e => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleToggle = () => {
    const wasOpen = isOpen;
    setIsOpen(!wasOpen);

    // Mark as read when opening
    if (!wasOpen && unreadCount > 0) {
      markNotificationsRead()
        .then(() => {
          setNotifications(prev => prev.map(n => ({ ...n, read: true })));
        })
        .catch(() => {});
    }
  };

  const formatTime = dateStr => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return intl.formatMessage({ id: 'NotificationBell.justNow' });
    if (diffMins < 60) return intl.formatMessage({ id: 'NotificationBell.minutesAgo' }, { count: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return intl.formatMessage({ id: 'NotificationBell.hoursAgo' }, { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    return intl.formatMessage({ id: 'NotificationBell.daysAgo' }, { count: diffDays });
  };

  const classes = classNames(rootClassName || css.root, className);

  return (
    <div className={classes} ref={dropdownRef}>
      <button
        type="button"
        onClick={handleToggle}
        aria-label={intl.formatMessage({ id: 'NotificationBell.ariaLabel' })}
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <svg className={css.bellIcon} viewBox="0 0 24 24">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 ? (
          <span className={css.badge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
        ) : null}
      </button>

      {isOpen ? (
        <div className={css.dropdown}>
          {notifications.length === 0 ? (
            <div className={css.emptyState}>
              {intl.formatMessage({ id: 'NotificationBell.empty' })}
            </div>
          ) : (
            notifications
              .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
              .slice(0, 20)
              .map(n =>
                n.type === 'promo' ? (
                  <NamedLink
                    key={n.id}
                    name="MyPromosPage"
                    className={classNames(css.notificationItem, { [css.unread]: !n.read })}
                  >
                    <span className={css.vendorName}>{n.title || 'Free Delivery'}</span>{' '}
                    {intl.formatMessage({ id: 'NotificationBell.promoGifted' })}
                    <span className={css.timestamp}>{formatTime(n.createdAt)}</span>
                  </NamedLink>
                ) : (
                  <NamedLink
                    key={n.id}
                    name="ListingPage"
                    params={{
                      id: n.listingId,
                      slug: n.listingTitle?.toLowerCase().replace(/\s+/g, '-') || 'listing',
                    }}
                    className={classNames(css.notificationItem, { [css.unread]: !n.read })}
                    onClick={() => setIsOpen(false)}
                  >
                    <span className={css.vendorName}>{n.vendorName}</span>{' '}
                    {intl.formatMessage(
                      { id: 'NotificationBell.newListing' },
                      { title: n.listingTitle }
                    )}
                    <span className={css.timestamp}>{formatTime(n.createdAt)}</span>
                  </NamedLink>
                )
              )
          )}
        </div>
      ) : null}
    </div>
  );
};

export default NotificationBell;
