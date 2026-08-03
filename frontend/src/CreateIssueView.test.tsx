import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateIssueView from './CreateIssueView';
import { renderWithProvidersAsync, useStubApi, TEST_USER } from './test/harness';

describe('CreateIssueView', () => {
  it('renders the issue form', async () => {
    useStubApi();
    await renderWithProvidersAsync(<CreateIssueView username={TEST_USER} />, {
      route: '/create_issue?component_id=2',
    });

    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
  });

  it('renders the Priority and Severity grid without leaking legacy Grid props', async () => {
    // Regression guard: these were <Grid item xs={6}>. In MUI 9 Grid has no `item`
    // prop, so it reached the DOM as item="true".
    useStubApi();
    await renderWithProvidersAsync(<CreateIssueView username={TEST_USER} />, {
      route: '/create_issue?component_id=2',
    });

    // MUI renders each label twice (InputLabel + fieldset legend), hence getAllByText.
    expect(screen.getAllByText('Priority').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Severity').length).toBeGreaterThan(0);
    expect(document.querySelector('[item]')).toBeNull();
    expect(screen.getByText('P2')).toBeInTheDocument();
    expect(screen.getByText('S2')).toBeInTheDocument();
  });

  it('offers the priority options when the select is opened', async () => {
    useStubApi();
    await renderWithProvidersAsync(<CreateIssueView username={TEST_USER} />, {
      route: '/create_issue?component_id=2',
    });

    // The Selects have no labelId, so they are not reachable by accessible name;
    // identify the Priority one by its default displayed value.
    const priority = screen
      .getAllByRole('combobox')
      .find((el) => el.textContent === 'P2');
    expect(priority).toBeDefined();

    await userEvent.click(priority as HTMLElement);
    expect(await screen.findByRole('option', { name: 'P0' })).toBeInTheDocument();
  });

  it('submits a new bug through the API', async () => {
    const create_bug = jest.fn().mockResolvedValue(
      (await import('standard-ts-lib/src/result')).Ok(99)
    );
    useStubApi({ create_bug });
    await renderWithProvidersAsync(<CreateIssueView username={TEST_USER} />, {
      route: '/create_issue?component_id=2',
    });

    await userEvent.type(screen.getByLabelText(/title/i), 'New crash on startup');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(create_bug).toHaveBeenCalled();
  });
});
