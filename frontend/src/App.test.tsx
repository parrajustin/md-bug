import { screen, waitFor } from '@testing-library/react';
import App from './App';
import { storage } from './api/storage';
import { setActiveSession } from './api/auth_api';
import {
  renderWithProvidersAsync,
  useStubApi,
  testSession,
  testBug,
  testBugSummary,
} from './test/harness';

describe('App', () => {
  beforeEach(() => {
    useStubApi();
  });

  it('shows the login view when there is no stored session', async () => {
    await storage.clearSession();
    setActiveSession(null);
    await renderWithProvidersAsync(<App />);

    expect(await screen.findByTestId('login-card')).toBeInTheDocument();
    expect(screen.getByTestId('login-password')).toBeInTheDocument();
    // The login screen has its own "IssueTracker" heading, so assert on something
    // only the signed-in chrome renders: Layout's search box.
    expect(screen.queryByLabelText('search')).not.toBeInTheDocument();
  });

  describe('when signed in', () => {
    beforeEach(async () => {
      await storage.setSession(testSession);
      setActiveSession(testSession);
    });

    it('renders the layout and bug list at the index route', async () => {
      await renderWithProvidersAsync(<App />, { route: '/' });

      expect(await screen.findByText('IssueTracker')).toBeInTheDocument();
      expect(await screen.findByText(testBugSummary.title)).toBeInTheDocument();
    });

    it('renders the create-component route', async () => {
      await renderWithProvidersAsync(<App />, { route: '/create_component' });

      expect(await screen.findByLabelText(/component name/i)).toBeInTheDocument();
    });

    it('renders the create-issue route', async () => {
      await renderWithProvidersAsync(<App />, { route: '/create_issue?component_id=2' });

      expect(await screen.findByLabelText(/title/i)).toBeInTheDocument();
    });

    it('renders the component editor route', async () => {
      await renderWithProvidersAsync(<App />, { route: '/component/2' });

      expect(await screen.findByText('Sub-Components')).toBeInTheDocument();
    });

    it('loads and renders a bug at /issue/:id', async () => {
      await renderWithProvidersAsync(<App />, { route: `/issue/${testBug.id}` });

      expect(await screen.findByDisplayValue(testBug.title)).toBeInTheDocument();
    });
  });
});
