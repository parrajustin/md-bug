import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Layout from './Layout';
import { renderWithProviders, useStubApi, TEST_USER } from './test/harness';

const defaultProps = {
  username: TEST_USER,
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
