import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ok, Err } from 'standard-ts-lib/src/result';
import { PermissionDeniedError } from 'standard-ts-lib/src/status_error';
import AccountView from './AccountView';
import { authApi, setActiveSession } from './api/auth_api';
import {
  renderWithProvidersAsync,
  useStubApi,
  TEST_USER,
  testSession,
  testBugSummary,
  testComponents,
} from './test/harness';

const tokenFixture = {
  id: 3,
  label: 'test_user--long_cat_fat',
  identity: 'test_user--long_cat_fat',
  created_at: 1718016000,
};

describe('AccountView', () => {
  beforeEach(() => {
    useStubApi();
    setActiveSession(testSession);
    jest.restoreAllMocks();
    jest.spyOn(authApi, 'listPersonalTokens').mockResolvedValue(Ok([]));
  });

  it('shows only components the user created', async () => {
    // testComponents are created by TEST_USER except one; ownership is by `creator`,
    // not by admin rights, which inherit down the tree.
    useStubApi({
      get_component_list: async () =>
        Ok([
          { ...testComponents[0], creator: TEST_USER },
          { ...testComponents[1], creator: 'someone_else' },
        ]),
    });
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin={false} />);

    expect(screen.getByTestId('owned-components')).toHaveTextContent(testComponents[0].name);
    expect(screen.getByTestId('owned-components')).not.toHaveTextContent(
      testComponents[1].name
    );
  });

  it('queries bugs with involves: so every participant field is covered', async () => {
    const get_bug_list = jest.fn().mockResolvedValue(Ok([testBugSummary]));
    useStubApi({ get_bug_list });
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin={false} />);

    expect(get_bug_list).toHaveBeenCalledWith(`involves:${TEST_USER}`);
    expect(screen.getByTestId('my-bugs')).toHaveTextContent(testBugSummary.title);
  });

  it('renders empty states when there is nothing to show', async () => {
    useStubApi({
      get_component_list: async () => Ok([]),
      get_bug_list: async () => Ok([]),
    });
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin={false} />);

    expect(screen.getByTestId('no-components')).toBeInTheDocument();
    expect(screen.getByTestId('no-bugs')).toBeInTheDocument();
    expect(screen.getByTestId('no-tokens')).toBeInTheDocument();
  });

  it('lists tokens by their bot identity, which is what goes in an ACL', async () => {
    jest.spyOn(authApi, 'listPersonalTokens').mockResolvedValue(Ok([tokenFixture]));
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin={false} />);

    expect(screen.getByTestId('token-list')).toHaveTextContent('test_user--long_cat_fat');
  });

  it('reveals a new token and its generated identity exactly once', async () => {
    const createPersonalToken = jest.spyOn(authApi, 'createPersonalToken').mockResolvedValue(
      Ok({ identity: 'test_user--long_cat_fat', token: 'mdb_pat_3.super-secret-value' })
    );
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin={false} />);

    await userEvent.click(screen.getByTestId('create-token'));

    // The name is generated server-side, so the client sends nothing.
    await waitFor(() =>
      expect(createPersonalToken).toHaveBeenCalledWith(testSession.accessToken)
    );
    expect(await screen.findByTestId('revealed-identity')).toHaveValue(
      'test_user--long_cat_fat'
    );
    expect(screen.getByTestId('revealed-token')).toHaveValue(
      'mdb_pat_3.super-secret-value'
    );

    // Dismissing must not leave the secret on screen — it is unrecoverable afterwards.
    await userEvent.click(screen.getByTestId('dismiss-token'));
    await waitFor(() =>
      expect(screen.queryByTestId('revealed-token')).not.toBeInTheDocument()
    );
  });

  it('needs no input to create a token', async () => {
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin={false} />);

    // Names are generated, so there is nothing to type and nothing to validate.
    expect(screen.getByTestId('create-token')).toBeEnabled();
    expect(screen.queryByTestId('token-label')).not.toBeInTheDocument();
  });

  it('revokes a token and refreshes the list', async () => {
    jest.spyOn(authApi, 'listPersonalTokens').mockResolvedValue(Ok([tokenFixture]));
    const revoke = jest
      .spyOn(authApi, 'revokePersonalToken')
      .mockResolvedValue(Ok(undefined));
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin={false} />);

    await userEvent.click(screen.getByTestId(`revoke-${tokenFixture.id}`));

    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith(testSession.accessToken, tokenFixture.id)
    );
  });

  it('surfaces a server rejection when creating a token', async () => {
    jest
      .spyOn(authApi, 'createPersonalToken')
      .mockResolvedValue(Err(PermissionDeniedError('Not permitted')));
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin={false} />);

    await userEvent.click(screen.getByTestId('create-token'));

    expect(await screen.findByTestId('account-error')).toHaveTextContent(/not permitted/i);
  });

  it('marks administrators', async () => {
    await renderWithProvidersAsync(<AccountView username={TEST_USER} isAdmin />);
    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });
});
