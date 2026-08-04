import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ok, Err } from 'standard-ts-lib/src/result';
import { PermissionDeniedError, UnauthenticatedError } from 'standard-ts-lib/src/status_error';
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
    jest.spyOn(authApi, 'listApiTokens').mockResolvedValue(Ok([]));
    jest.spyOn(authApi, 'listBotTokens').mockResolvedValue(Ok([]));
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
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    expect(screen.getByTestId('owned-components')).toHaveTextContent(testComponents[0].name);
    expect(screen.getByTestId('owned-components')).not.toHaveTextContent(
      testComponents[1].name
    );
  });

  it('queries bugs with involves: so every participant field is covered', async () => {
    const get_bug_list = jest.fn().mockResolvedValue(Ok([testBugSummary]));
    useStubApi({ get_bug_list });
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    expect(get_bug_list).toHaveBeenCalledWith(`involves:${TEST_USER}`);
    expect(screen.getByTestId('my-bugs')).toHaveTextContent(testBugSummary.title);
  });

  it('renders empty states when there is nothing to show', async () => {
    useStubApi({
      get_component_list: async () => Ok([]),
      get_bug_list: async () => Ok([]),
    });
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    expect(screen.getByTestId('no-components')).toBeInTheDocument();
    expect(screen.getByTestId('no-bugs')).toBeInTheDocument();
    expect(screen.getByTestId('no-api-tokens')).toBeInTheDocument();
    expect(screen.getByTestId('no-bot-tokens')).toBeInTheDocument();
  });

  it('lists bots by their identity, which is what goes in an ACL', async () => {
    jest.spyOn(authApi, 'listBotTokens').mockResolvedValue(Ok([tokenFixture]));
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    expect(screen.getByTestId('bot-token-list')).toHaveTextContent('test_user--long_cat_fat');
  });

  it('reveals a new bot token and its generated identity exactly once', async () => {
    const createPersonalToken = jest.spyOn(authApi, 'createBotToken').mockResolvedValue(
      Ok({ identity: 'test_user--long_cat_fat', token: 'mdb_bot_3.super-secret-value' })
    );
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    await userEvent.click(screen.getByTestId('create-bot-token'));

    // The name is generated server-side, so the client sends nothing.
    await waitFor(() =>
      expect(createPersonalToken).toHaveBeenCalledWith(testSession.accessToken)
    );
    expect(await screen.findByTestId('revealed-identity')).toHaveValue(
      'test_user--long_cat_fat'
    );
    expect(screen.getByTestId('revealed-token')).toHaveValue(
      'mdb_bot_3.super-secret-value'
    );

    // Dismissing must not leave the secret on screen — it is unrecoverable afterwards.
    await userEvent.click(screen.getByTestId('dismiss-token'));
    await waitFor(() =>
      expect(screen.queryByTestId('revealed-token')).not.toBeInTheDocument()
    );
  });

  it('creates an API token that acts as the user, with no ACL identity', async () => {
    const createApiToken = jest
      .spyOn(authApi, 'createApiToken')
      .mockResolvedValue(Ok({ label: 'long_cat_fat', token: 'mdb_api_4.secret' }));
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    await userEvent.click(screen.getByTestId('create-api-token'));

    await waitFor(() =>
      expect(createApiToken).toHaveBeenCalledWith(testSession.accessToken)
    );
    // An API token is the user, so what is shown is a label, not an ACL identity.
    expect(await screen.findByTestId('revealed-identity')).toHaveValue('long_cat_fat');
    expect(screen.getByTestId('revealed-token')).toHaveValue('mdb_api_4.secret');
  });

  it('keeps API tokens and bot accounts in separate lists', async () => {
    jest.spyOn(authApi, 'listApiTokens').mockResolvedValue(
      Ok([{ id: 1, label: 'long_cat_fat', identity: null, created_at: 0 }])
    );
    jest.spyOn(authApi, 'listBotTokens').mockResolvedValue(Ok([tokenFixture]));
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    expect(screen.getByTestId('api-token-list')).toHaveTextContent('long_cat_fat');
    expect(screen.getByTestId('api-token-list')).not.toHaveTextContent('test_user--');
    expect(screen.getByTestId('bot-token-list')).toHaveTextContent('test_user--long_cat_fat');
  });

  it('needs no input to create a token', async () => {
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    // Names are generated, so there is nothing to type and nothing to validate.
    expect(screen.getByTestId('create-api-token')).toBeEnabled();
    expect(screen.getByTestId('create-bot-token')).toBeEnabled();
    expect(screen.queryByTestId('token-label')).not.toBeInTheDocument();
  });

  it('revokes a bot and refreshes the list', async () => {
    jest.spyOn(authApi, 'listBotTokens').mockResolvedValue(Ok([tokenFixture]));
    const revoke = jest
      .spyOn(authApi, 'revokeBotToken')
      .mockResolvedValue(Ok(undefined));
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    await userEvent.click(screen.getByTestId(`revoke-bot-${tokenFixture.id}`));

    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith(testSession.accessToken, tokenFixture.id)
    );
  });

  it('surfaces a server rejection when creating a token', async () => {
    jest
      .spyOn(authApi, 'createBotToken')
      .mockResolvedValue(Err(PermissionDeniedError('Not permitted')));
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
    );

    await userEvent.click(screen.getByTestId('create-bot-token'));

    expect(await screen.findByTestId('account-error')).toHaveTextContent(/not permitted/i);
  });

  describe('password card', () => {
    const fillPassword = async (current: string, next: string, confirm: string) => {
      await userEvent.type(screen.getByTestId('account-current-password'), current);
      await userEvent.type(screen.getByTestId('account-new-password'), next);
      await userEvent.type(screen.getByTestId('account-confirm-password'), confirm);
      await userEvent.click(screen.getByTestId('change-password'));
    };

    it('renders three masked fields at the top of the page', async () => {
      await renderWithProvidersAsync(
        <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
      );

      for (const id of [
        'account-current-password',
        'account-new-password',
        'account-confirm-password',
      ]) {
        expect(screen.getByTestId(id)).toHaveAttribute('type', 'password');
      }
    });

    it('rejects a short password without calling the API', async () => {
      const change = jest.spyOn(authApi, 'changePassword');
      await renderWithProvidersAsync(
        <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
      );

      await fillPassword('old-password', 'short', 'short');

      expect(await screen.findByTestId('password-error')).toHaveTextContent(/at least 8/i);
      expect(change).not.toHaveBeenCalled();
    });

    it('rejects a mismatched confirmation without calling the API', async () => {
      const change = jest.spyOn(authApi, 'changePassword');
      await renderWithProvidersAsync(
        <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
      );

      await fillPassword('old-password', 'brand-new-password', 'brand-new-passward');

      expect(await screen.findByTestId('password-error')).toHaveTextContent(/do not match/i);
      expect(change).not.toHaveBeenCalled();
    });

    it('rejects reusing the current password', async () => {
      const change = jest.spyOn(authApi, 'changePassword');
      await renderWithProvidersAsync(
        <AccountView username={TEST_USER} isAdmin={false} onPasswordChanged={() => {}} />
      );

      await fillPassword('same-password-99', 'same-password-99', 'same-password-99');

      expect(await screen.findByTestId('password-error')).toHaveTextContent(/different/i);
      expect(change).not.toHaveBeenCalled();
    });

    it('changes the password and signs the user out', async () => {
      const change = jest
        .spyOn(authApi, 'changePassword')
        .mockResolvedValue(Ok(undefined));
      const onPasswordChanged = jest.fn();
      await renderWithProvidersAsync(
        <AccountView
          username={TEST_USER}
          isAdmin={false}
          onPasswordChanged={onPasswordChanged}
        />
      );

      await fillPassword('old-password', 'my-new-password', 'my-new-password');

      await waitFor(() =>
        expect(change).toHaveBeenCalledWith(TEST_USER, 'old-password', 'my-new-password')
      );
      // The server revokes every token, so staying signed in would be a lie.
      await waitFor(() => expect(onPasswordChanged).toHaveBeenCalled());
    });

    it('surfaces a wrong current password and stays put', async () => {
      jest
        .spyOn(authApi, 'changePassword')
        .mockResolvedValue(Err(UnauthenticatedError('Incorrect username or password')));
      const onPasswordChanged = jest.fn();
      await renderWithProvidersAsync(
        <AccountView
          username={TEST_USER}
          isAdmin={false}
          onPasswordChanged={onPasswordChanged}
        />
      );

      await fillPassword('wrong-current', 'my-new-password', 'my-new-password');

      expect(await screen.findByTestId('password-error')).toHaveTextContent(/incorrect/i);
      expect(onPasswordChanged).not.toHaveBeenCalled();
    });
  });

  it('marks administrators', async () => {
    await renderWithProvidersAsync(
      <AccountView username={TEST_USER} isAdmin onPasswordChanged={() => {}} />
    );
    expect(screen.getByText('Administrator')).toBeInTheDocument();
  });
});
