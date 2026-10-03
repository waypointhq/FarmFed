import React, { useState } from 'react';
import '@testing-library/jest-dom';

import { renderWithProviders as render, testingLibrary } from '../../../util/testHelpers';
import CustomerMultiSelect from './CustomerMultiSelect';

jest.mock('../../../util/api', () => ({ adminFetchAllCustomers: jest.fn() }));

const api = require('../../../util/api');
const { screen, userEvent, waitFor } = testingLibrary;

const people = [
  {
    id: 'c1',
    name: 'Sarah Miller',
    email: 'sarah@example.com',
    userType: 'Consumer',
    kind: 'customer',
  },
  { id: 'c2', name: 'Tom Reed', email: 'tom@example.com', userType: 'Consumer', kind: 'customer' },
  { id: 'v1', name: 'Hill Farm', email: 'hill@example.com', userType: 'Farmer', kind: 'vendor' },
];

let latest = [];
const Harness = () => {
  const [selected, setSelected] = useState([]);
  latest = selected;
  return <CustomerMultiSelect selected={selected} onChange={setSelected} />;
};

describe('CustomerMultiSelect', () => {
  beforeEach(() => {
    api.adminFetchAllCustomers.mockResolvedValue({ customers: people });
  });

  it('shows customers by default and selects everyone shown at once', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('Sarah Miller')).toBeInTheDocument());
    expect(screen.queryByText('Hill Farm')).not.toBeInTheDocument();

    userEvent.click(screen.getByLabelText('AdminPage.promos.gift.selectAllShown'));
    expect(latest.map(p => p.id)).toEqual(['c1', 'c2']);

    // Unticking "all shown" clears just those.
    userEvent.click(screen.getByLabelText('AdminPage.promos.gift.selectAllShown'));
    expect(latest).toEqual([]);
  });

  it('filters by type and search, and keeps earlier picks', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText('Sarah Miller')).toBeInTheDocument());

    userEvent.click(screen.getByText('Sarah Miller'));
    userEvent.click(screen.getByText(/AdminPage.promos.gift.kind.vendor/));
    expect(screen.getByText('Hill Farm')).toBeInTheDocument();
    expect(screen.queryByText('Sarah Miller')).not.toBeInTheDocument();

    userEvent.click(screen.getByText(/AdminPage.promos.gift.kind.all/));
    userEvent.type(screen.getByRole('textbox'), 'tom@');
    expect(screen.getByText('Tom Reed')).toBeInTheDocument();
    expect(screen.queryByText('Hill Farm')).not.toBeInTheDocument();
    userEvent.click(screen.getByText('Tom Reed'));

    expect(latest.map(p => p.id)).toEqual(['c1', 'c2']);
  });
});
