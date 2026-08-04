import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ok, Err } from 'standard-ts-lib/src/result';
import { PermissionDeniedError } from 'standard-ts-lib/src/status_error';
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

describe('BugView markers', () => {
  beforeEach(() => {
    useStubApi();
  });

  it('shows an unstarred, un-upvoted bug as neutral', async () => {
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    expect(screen.getByTestId('star-button')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('upvote-button')).toHaveAttribute('aria-pressed', 'false');
    // The count comes from the array length, so an empty list reads as zero.
    expect(screen.getByTestId('upvote-button')).toHaveTextContent('0');
  });

  it('reflects a bug the user has already starred and upvoted', async () => {
    const marked = {
      ...testBug,
      metadata: {
        ...testBug.metadata,
        starred_by: [TEST_USER],
        upvoted_by: [TEST_USER, 'someone_else'],
      },
    };
    await renderWithProvidersAsync(<BugView {...defaultProps} bug={marked} />);

    expect(screen.getByTestId('star-button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('upvote-button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('upvote-button')).toHaveTextContent('2');
  });

  it('stars a bug and flips the control immediately', async () => {
    const set_bug_star = jest.fn().mockResolvedValue(Ok({ state_id: 2n }));
    useStubApi({ set_bug_star });
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    await userEvent.click(screen.getByTestId('star-button'));

    await waitFor(() => expect(set_bug_star).toHaveBeenCalledWith(testBug.id, true));
    // Optimistic: the control reflects the new state without waiting for a refetch.
    await waitFor(() =>
      expect(screen.getByTestId('star-button')).toHaveAttribute('aria-pressed', 'true')
    );
  });

  it('un-stars a bug that was starred', async () => {
    const set_bug_star = jest.fn().mockResolvedValue(Ok({ state_id: 2n }));
    useStubApi({ set_bug_star });
    const marked = {
      ...testBug,
      metadata: { ...testBug.metadata, starred_by: [TEST_USER] },
    };
    await renderWithProvidersAsync(<BugView {...defaultProps} bug={marked} />);

    await userEvent.click(screen.getByTestId('star-button'));

    await waitFor(() => expect(set_bug_star).toHaveBeenCalledWith(testBug.id, false));
  });

  it('upvotes and increments the count', async () => {
    const set_bug_upvote = jest.fn().mockResolvedValue(Ok({ state_id: 2n }));
    useStubApi({ set_bug_upvote });
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    await userEvent.click(screen.getByTestId('upvote-button'));

    await waitFor(() => expect(set_bug_upvote).toHaveBeenCalledWith(testBug.id, true));
    await waitFor(() =>
      expect(screen.getByTestId('upvote-button')).toHaveTextContent('1')
    );
  });

  it('rolls the control back when the server rejects the change', async () => {
    const set_bug_star = jest
      .fn()
      .mockResolvedValue(Err(PermissionDeniedError('nope')));
    useStubApi({ set_bug_star });
    // alert() is used for the failure path; silence it so the test does not blow up.
    jest.spyOn(window, 'alert').mockImplementation(() => {});
    await renderWithProvidersAsync(<BugView {...defaultProps} />);

    await userEvent.click(screen.getByTestId('star-button'));

    // Optimism must not survive a rejection, or the UI would lie about saved state.
    await waitFor(() =>
      expect(screen.getByTestId('star-button')).toHaveAttribute('aria-pressed', 'false')
    );
  });
});
