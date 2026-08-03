import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ok, Err } from 'standard-ts-lib/src/result';
import { PermissionDeniedError } from 'standard-ts-lib/src/status_error';
import CreateComponentView from './CreateComponentView';
import { renderWithProvidersAsync, useStubApi, TEST_USER, testComponents } from './test/harness';

describe('CreateComponentView', () => {
  it('renders the form with the component list loaded', async () => {
    useStubApi();
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin={false} />);

    expect(screen.getByLabelText(/component name/i)).toBeInTheDocument();
  });

  it('preselects the first available parent so the form opens usable', async () => {
    // DEFAULT is created automatically on first start, so there is always a real parent
    // to pick; opening on the unusable [Root] entry would just be a required extra click.
    useStubApi();
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin={false} />);

    expect(screen.getByRole('button', { name: /create component/i })).toBeEnabled();
    expect(screen.getAllByText(testComponents[0].name).length).toBeGreaterThan(0);
  });

  it('disables submit when there is no parent to select', async () => {
    // The backend rejects parent_id 0 with 403 unconditionally, so the form must not let
    // a non-admin submit with no parent.
    useStubApi({ get_component_list: async () => Ok([]) });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin={false} />);

    expect(screen.getByRole('button', { name: /create component/i })).toBeDisabled();
    expect(screen.getByText(/only an administrator can create a root component/i))
      .toBeInTheDocument();
  });

  it('hides the root toggle from non-admins', async () => {
    useStubApi();
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin={false} />);

    expect(screen.queryByTestId('root-toggle')).not.toBeInTheDocument();
  });

  it('marks the Root option as disabled in the parent dropdown', async () => {
    useStubApi();
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin={false} />);

    const parent = screen
      .getAllByRole('combobox')
      .find((el) => /root/i.test(el.textContent ?? ''));
    await userEvent.click(parent as HTMLElement);

    const rootOption = await screen.findByRole('option', { name: /\[Root\]/i });
    expect(rootOption).toHaveAttribute('aria-disabled', 'true');
  });

  it('enables submit and posts once a parent component is selected', async () => {
    const create_component = jest.fn().mockResolvedValue(Ok(undefined));
    useStubApi({ create_component });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin={false} />, {
      route: '/create_component?parent_id=1',
    });

    await userEvent.type(screen.getByLabelText(/component name/i), 'new_widget');

    const submit = screen.getByRole('button', { name: /create component/i });
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    // No username argument: identity travels in the bearer token, not the payload.
    expect(create_component).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'new_widget', parent_id: 1 })
    );
  });

  it('tells a non-admin to ask an administrator when nothing exists yet', async () => {
    useStubApi({ get_component_list: async () => Ok([]) });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin={false} />);

    expect(screen.getByTestId('no-components-notice')).toHaveTextContent(
      /only an administrator can create a root component/i
    );
  });

  it('points an admin at the toggle when nothing exists yet', async () => {
    useStubApi({ get_component_list: async () => Ok([]) });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin />);

    expect(screen.getByTestId('no-components-notice')).toHaveTextContent(
      /create as a root component/i
    );
    expect(screen.getByTestId('root-toggle')).toBeInTheDocument();
  });

  it('swaps the parent picker for a warning when the root toggle is on', async () => {
    useStubApi();
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin />);

    // The Select has no labelId, so it is not reachable by accessible name; match the
    // rendered label text instead.
    expect(screen.getAllByText('Parent Component').length).toBeGreaterThan(0);

    await userEvent.click(screen.getByTestId('root-toggle'));

    // No parent to choose, so the picker goes away entirely.
    expect(screen.queryByText('Parent Component')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-mode-notice')).toBeInTheDocument();
  });

  it('submits to the root endpoint, not create_component, when toggled on', async () => {
    const create_component = jest.fn().mockResolvedValue(Ok(undefined));
    const create_root_component = jest.fn().mockResolvedValue(Ok(7));
    useStubApi({ create_component, create_root_component });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin />);

    await userEvent.click(screen.getByTestId('root-toggle'));
    await userEvent.type(screen.getByLabelText(/component name/i), 'my_project');
    await userEvent.click(screen.getByRole('button', { name: /create component/i }));

    await waitFor(() =>
      expect(create_root_component).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'my_project' })
      )
    );
    // create_component still rejects parent_id 0 server-side; it must not be used here.
    expect(create_component).not.toHaveBeenCalled();
  });

  it('enables submit via the root toggle even with nothing to nest under', async () => {
    useStubApi({ get_component_list: async () => Ok([]) });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin />);

    expect(screen.getByRole('button', { name: /create component/i })).toBeDisabled();
    await userEvent.click(screen.getByTestId('root-toggle'));
    expect(screen.getByRole('button', { name: /create component/i })).toBeEnabled();
  });

  it('shows a server rejection inline instead of losing the form', async () => {
    const create_root_component = jest
      .fn()
      .mockResolvedValue(Err(PermissionDeniedError('Not permitted')));
    useStubApi({ create_root_component });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} isAdmin />);

    await userEvent.click(screen.getByTestId('root-toggle'));
    await userEvent.type(screen.getByLabelText(/component name/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /create component/i }));

    expect(await screen.findByTestId('create-error')).toHaveTextContent(/not permitted/i);
    expect(screen.getByLabelText(/component name/i)).toBeInTheDocument();
  });
});
