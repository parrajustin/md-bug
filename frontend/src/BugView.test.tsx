import { screen } from '@testing-library/react';
import BugView from './BugView';
import { renderWithProvidersAsync, useStubApi, TEST_USER, testBug } from './test/harness';

const defaultProps = {
  bug: testBug,
  onHome: () => {},
  onRefresh: () => {},
  onSearch: () => {},
  username: TEST_USER,
};

describe('BugView', () => {
  beforeEach(() => {
    useStubApi();
  });

  it('renders the bug title and status', async () => {
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    expect(screen.getByDisplayValue(testBug.title)).toBeInTheDocument();
    expect(screen.getByText(testBug.metadata.status)).toBeInTheDocument();
  });

  it('renders the editable title field for a user with full access', async () => {
    // Regression guard: the title TextField used InputProps, removed in MUI 9.
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    expect(screen.getByDisplayValue(testBug.title)).toBeInTheDocument();
    expect(document.querySelector('[inputprops]')).toBeNull();
  });

  it('renders a read-only title for a user with no access grant', async () => {
    // "stranger" is in no access list, and the stub component metadata only grants
    // PUBLIC comment-level permissions — so no full access, hence no edit field.
    await renderWithProvidersAsync(<BugView {...defaultProps} username="stranger" />);

    expect(screen.getByText(testBug.title)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(testBug.title)).not.toBeInTheDocument();
  });

  it('populates the Type/Priority/Severity selects from bug metadata', async () => {
    // Regression guard: these read bug.metadata[field]. The Type select previously
    // read a non-existent `bug_type` field and rendered undefined, which MUI reports
    // as "out-of-range value `undefined` for the select component".
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    expect(screen.getByText(testBug.metadata.type)).toBeInTheDocument();
    expect(screen.getByText(testBug.metadata.priority)).toBeInTheDocument();
    expect(screen.getByText(testBug.metadata.severity)).toBeInTheDocument();
  });

  it('renders markdown comment content as sanitized HTML', async () => {
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    // The comment body contains `main` in backticks; marked should emit <code>.
    expect(document.querySelector('code')).not.toBeNull();
    expect(screen.getByText('main')).toBeInTheDocument();
  });

  it('formats timestamps as dates rather than raw nanoseconds', async () => {
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    expect(
      screen.queryByText(new RegExp(String(testBug.metadata.created_at)))
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/2024/).length).toBeGreaterThan(0);
  });

  it('renders the comment author', async () => {
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    expect(
      screen.getAllByText(new RegExp(testBug.comments[0].author, 'i')).length
    ).toBeGreaterThan(0);
  });
});
