import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Layout from './Layout';
import { renderWithProviders, useStubApi, TEST_USER } from './test/harness';

const defaultProps = {
  username: TEST_USER,
  isAdmin: false,
  onSignOut: () => {},
  searchValue: '',
  onSearch: () => {},
  bugComponentId: null,
};

describe('Layout', () => {
  beforeEach(() => {
    useStubApi();
  });

  it('renders the app bar, search box and children', () => {
    renderWithProviders(
      <Layout {...defaultProps}>
        <div>page content</div>
      </Layout>
    );

    expect(screen.getByText('IssueTracker')).toBeInTheDocument();
    expect(screen.getByLabelText('search')).toBeInTheDocument();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('renders drawer navigation items via ListItemText', () => {
    // Regression guard: ListItemText used primaryTypographyProps, removed in MUI 9.
    renderWithProviders(
      <Layout {...defaultProps}>
        <div />
      </Layout>
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('opens the create menu without leaking PaperProps to the DOM', async () => {
    // Regression guard: <Menu PaperProps> was removed in MUI 9 in favour of
    // slotProps.paper. The menu must actually be opened for the Paper to mount.
    renderWithProviders(
      <Layout {...defaultProps}>
        <div />
      </Layout>
    );

    // The split-button caret has no accessible name, so locate it by its icon.
    const dropdown = screen.getByTestId('ArrowDropDownIcon').closest('button');
    expect(dropdown).not.toBeNull();
    await userEvent.click(dropdown as HTMLElement);

    expect(await screen.findByText('Create Component')).toBeInTheDocument();
    expect(document.querySelector('[paperprops]')).toBeNull();
  });

  it('forwards typed search text to onSearch on Enter', async () => {
    const onSearch = jest.fn();
    renderWithProviders(
      <Layout {...defaultProps} onSearch={onSearch}>
        <div />
      </Layout>
    );

    const search = screen.getByLabelText('search');
    await userEvent.type(search, 'crash{Enter}');

    expect(onSearch).toHaveBeenCalled();
  });
});

describe('Layout navigation', () => {
  beforeEach(() => {
    useStubApi();
  });

  const renderNav = (onSearch = jest.fn()) => {
    renderWithProviders(
      <Layout {...defaultProps} onSearch={onSearch}>
        <div />
      </Layout>
    );
    return onSearch;
  };

  it('offers no dead entries', () => {
    renderNav();

    // These two were debugging leftovers that jumped to hardcoded bug ids.
    expect(screen.queryByText('Non-existent Bug')).not.toBeInTheDocument();

    for (const label of [
      'Assigned to me',
      'Starred by me',
      'Upvoted by me',
      "CC'd to me",
      'Collaborating',
      'Reported by me',
      'To be verified',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it.each([
    ['nav-assigned-to-me', `assignee:${TEST_USER}`],
    ['nav-starred-by-me', `starred:${TEST_USER}`],
    ['nav-upvoted-by-me', `upvoted:${TEST_USER}`],
    ['nav-cc-d-to-me', `cc:${TEST_USER}`],
    ['nav-collaborating', `collaborator:${TEST_USER}`],
    ['nav-reported-by-me', `reporter:${TEST_USER}`],
    ['nav-to-be-verified', `verifier:${TEST_USER}`],
  ])('%s searches for %s', async (testId, query) => {
    const onSearch = renderNav();

    await userEvent.click(screen.getByTestId(testId));

    expect(onSearch).toHaveBeenCalledWith(query);
  });

  it('Home clears the search rather than filtering', async () => {
    const onSearch = renderNav();

    await userEvent.click(screen.getByTestId('nav-home'));

    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('highlights whichever saved search is showing', () => {
    renderWithProviders(
      <Layout {...defaultProps} searchValue={`starred:${TEST_USER}`} onSearch={() => {}}>
        <div />
      </Layout>
    );

    expect(screen.getByTestId('nav-starred-by-me')).toHaveClass('Mui-selected');
    expect(screen.getByTestId('nav-home')).not.toHaveClass('Mui-selected');
  });

  it('shows the admin entry only to admins', async () => {
    renderWithProviders(
      <Layout {...defaultProps} isAdmin={false}>
        <div />
      </Layout>
    );
    await userEvent.click(screen.getByTestId('user-menu'));
    expect(screen.queryByTestId('menu-admin')).not.toBeInTheDocument();
  });

  it('shows the admin entry to an admin', async () => {
    renderWithProviders(
      <Layout {...defaultProps} isAdmin>
        <div />
      </Layout>
    );
    await userEvent.click(screen.getByTestId('user-menu'));
    expect(await screen.findByTestId('menu-admin')).toBeInTheDocument();
  });
});

describe('Layout user menu dismissal', () => {
  beforeEach(() => {
    useStubApi();
  });

  const openMenu = async () => {
    await userEvent.click(screen.getByTestId('user-menu'));
    expect(await screen.findByTestId('menu-account')).toBeInTheDocument();
  };

  it('closes when a menu item is chosen', async () => {
    // Regression: the Menu used to be a child of its trigger. MUI portals it out of the
    // DOM, but React events bubble through the React tree, so choosing an item bubbled
    // back into the trigger's onClick and reopened the menu straight away.
    renderWithProviders(
      <Layout {...defaultProps}>
        <div />
      </Layout>
    );
    await openMenu();

    await userEvent.click(screen.getByTestId('menu-account'));

    await waitFor(() =>
      expect(screen.queryByTestId('menu-account')).not.toBeInTheDocument()
    );
  });

  it('closes when clicking away, rather than trapping the page', async () => {
    renderWithProviders(
      <Layout {...defaultProps}>
        <div>page content</div>
      </Layout>
    );
    await openMenu();

    // MUI puts an invisible backdrop over the page; clicking it must dismiss the menu.
    // While the bug was present the same click reopened it, so the backdrop stayed up
    // and swallowed every subsequent click.
    const backdrop = document.querySelector('.MuiBackdrop-root, .MuiModal-backdrop');
    expect(backdrop).not.toBeNull();
    await userEvent.click(backdrop as Element);

    await waitFor(() =>
      expect(screen.queryByTestId('menu-account')).not.toBeInTheDocument()
    );
  });

  it('leaves the page clickable after the menu is dismissed', async () => {
    const onSearch = jest.fn();
    renderWithProviders(
      <Layout {...defaultProps} onSearch={onSearch}>
        <div />
      </Layout>
    );
    await openMenu();

    const backdrop = document.querySelector('.MuiBackdrop-root, .MuiModal-backdrop');
    await userEvent.click(backdrop as Element);
    await waitFor(() =>
      expect(screen.queryByTestId('menu-account')).not.toBeInTheDocument()
    );

    // The actual complaint: nothing else on the page responded afterwards.
    await userEvent.click(screen.getByTestId('nav-starred-by-me'));
    expect(onSearch).toHaveBeenCalledWith(`starred:${TEST_USER}`);
  });

  it('closes on sign out', async () => {
    const onSignOut = jest.fn();
    renderWithProviders(
      <Layout {...defaultProps} onSignOut={onSignOut}>
        <div />
      </Layout>
    );
    await openMenu();

    await userEvent.click(screen.getByTestId('menu-sign-out'));

    expect(onSignOut).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId('menu-account')).not.toBeInTheDocument()
    );
  });

  it('can be reopened after being dismissed', async () => {
    renderWithProviders(
      <Layout {...defaultProps}>
        <div />
      </Layout>
    );
    await openMenu();

    const backdrop = document.querySelector('.MuiBackdrop-root, .MuiModal-backdrop');
    await userEvent.click(backdrop as Element);
    await waitFor(() =>
      expect(screen.queryByTestId('menu-account')).not.toBeInTheDocument()
    );

    await openMenu();
  });
});
