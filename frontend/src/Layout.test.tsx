import { screen } from '@testing-library/react';
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
