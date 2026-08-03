import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ok } from 'standard-ts-lib/src/result';
import CreateComponentView from './CreateComponentView';
import { renderWithProvidersAsync, useStubApi, TEST_USER } from './test/harness';

describe('CreateComponentView', () => {
  it('renders the form with the component list loaded', async () => {
    useStubApi();
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} />);

    expect(screen.getByLabelText(/component name/i)).toBeInTheDocument();
  });

  it('disables submit until a real parent is chosen', async () => {
    // The backend rejects parent_id 0 with 403 unconditionally, so the form must not
    // let the user submit the default Root selection.
    useStubApi();
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} />);

    expect(screen.getByRole('button', { name: /create component/i })).toBeDisabled();
    expect(screen.getByText(/root components are created with the backend cli/i))
      .toBeInTheDocument();
  });

  it('marks the Root option as disabled in the parent dropdown', async () => {
    useStubApi();
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} />);

    const parent = screen
      .getAllByRole('combobox')
      .find((el) => /root/i.test(el.textContent ?? ''));
    await userEvent.click(parent as HTMLElement);

    const rootOption = await screen.findByRole('option', { name: /create via CLI only/i });
    expect(rootOption).toHaveAttribute('aria-disabled', 'true');
  });

  it('enables submit and posts once a parent component is selected', async () => {
    const create_component = jest.fn().mockResolvedValue(Ok(undefined));
    useStubApi({ create_component });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} />, {
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

  it('explains how to bootstrap when no components exist yet', async () => {
    useStubApi({ get_component_list: async () => Ok([]) });
    await renderWithProvidersAsync(<CreateComponentView username={TEST_USER} />);

    expect(screen.getByText(/no components exist yet/i)).toBeInTheDocument();
    expect(screen.getByText(/CreateRootComponent/)).toBeInTheDocument();
  });
});
