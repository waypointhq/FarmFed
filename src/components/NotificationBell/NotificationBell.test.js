import React from 'react';
import '@testing-library/jest-dom';
import { act } from '@testing-library/react';

import { renderWithProviders as render, getDefaultConfiguration } from '../../util/testHelpers';
import { fetchNotifications } from '../../util/api';
import NotificationBell from './NotificationBell';

jest.mock('../../util/api', () => ({
  fetchNotifications: jest.fn(),
  markNotificationsRead: jest.fn(),
}));
jest.mock('../../util/pushNotifications', () => ({
  registerPushToken: () => {},
  checkInjectedPushToken: () => {},
}));

const MINUTE = 60000;

// Lets the rejected/resolved fetch settle before time moves on.
const flush = () => act(() => Promise.resolve());

describe('NotificationBell polling', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('checks for notifications every minute', async () => {
    fetchNotifications.mockResolvedValue({ notifications: [] });
    render(<NotificationBell />, { config: getDefaultConfiguration() });
    await flush();

    await act(async () => {
      jest.advanceTimersByTime(2 * MINUTE);
    });
    expect(fetchNotifications).toHaveBeenCalledTimes(3);
  });

  it('stops once the session has ended', async () => {
    fetchNotifications.mockRejectedValue(Object.assign(new Error(), { status: 403 }));
    render(<NotificationBell />, { config: getDefaultConfiguration() });
    await flush();

    await act(async () => {
      jest.advanceTimersByTime(5 * MINUTE);
    });
    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });

  it('keeps trying after other failures', async () => {
    fetchNotifications.mockRejectedValue(Object.assign(new Error(), { status: 500 }));
    render(<NotificationBell />, { config: getDefaultConfiguration() });
    await flush();

    await act(async () => {
      jest.advanceTimersByTime(MINUTE);
    });
    expect(fetchNotifications).toHaveBeenCalledTimes(2);
  });
});
