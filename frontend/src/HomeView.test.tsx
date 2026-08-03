import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Err } from 'standard-ts-lib/src/result';
import { InternalError } from 'standard-ts-lib/src/status_error';
import HomeView from './HomeView';
import { renderWithProviders, useStubApi, TEST_USER, testBugSummary } from './test/harness';

describe('HomeView', () => {
  it('renders the bug list returned by the API', async () => {
    useStubApi();
    renderWithProviders(
      <HomeView onBugSelect={() => {}} username={TEST_USER} onSearch={() => {}} />
    );

    expect(await screen.findByText(testBugSummary.title)).toBeInTheDocument();
  });

  it('selects a bug when its row is clicked', async () => {
    useStubApi();
    const onBugSelect = jest.fn();
    renderWithProviders(
      <HomeView onBugSelect={onBugSelect} username={TEST_USER} onSearch={() => {}} />
    );

    await userEvent.click(await screen.findByText(testBugSummary.title));
    await waitFor(() => expect(onBugSelect).toHaveBeenCalledWith(testBugSummary.id));
  });

  it('renders an empty list without crashing', async () => {
    useStubApi({ get_bug_list: async () => (await import('standard-ts-lib/src/result')).Ok([]) });
    renderWithProviders(
      <HomeView onBugSelect={() => {}} username={TEST_USER} onSearch={() => {}} />
    );

    await waitFor(() =>
      expect(screen.queryByText(testBugSummary.title)).not.toBeInTheDocument()
    );
  });

  it('surfaces an API failure instead of rendering a broken list', async () => {
    useStubApi({ get_bug_list: async () => Err(InternalError('backend exploded')) });
    renderWithProviders(
      <HomeView onBugSelect={() => {}} username={TEST_USER} onSearch={() => {}} />
    );

    expect(await screen.findByText(/backend exploded/i)).toBeInTheDocument();
  });
});
