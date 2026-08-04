import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ok, Err } from 'standard-ts-lib/src/result';
import { PermissionDeniedError, InvalidArgumentError } from 'standard-ts-lib/src/status_error';
import AdminView from './AdminView';
import { authApi, setActiveSession } from './api/auth_api';
import { renderWithProvidersAsync, useStubApi, testSession, TEST_USER } from './test/harness';

const users = [
  {
    username: TEST_USER,
    uid: 1,
    is_admin: true,
    must_change_password: false,
    disabled: false,
  },
  { username: 'bob', uid: 2, is_admin: false, must_change_password: true, disabled: false },
  { username: 'carol', uid: 3, is_admin: false, must_change_password: false, disabled: true },
];

describe('AdminView', () => {
  beforeEach(() => {
    useStubApi();
    setActiveSession(testSession);
    jest.restoreAllMocks();
    jest.spyOn(authApi, 'listUsers').mockResolvedValue(Ok(users));
    jest.spyOn(authApi, 'listAllTokens').mockResolvedValue(Ok([]));
  });

  it('lists every account with its status', async () => {
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    expect(screen.getByTestId('user-row-bob')).toHaveTextContent(/must set password/i);
    expect(screen.getByTestId('user-row-carol')).toHaveTextContent(/disabled/i);
    expect(screen.getByTestId(`user-row-${TEST_USER}`)).toHaveTextContent(/admin/i);
  });

  it('creates a user and reveals the generated password once', async () => {
    const createUser = jest
      .spyOn(authApi, 'createUser')
      .mockResolvedValue(Ok({ username: 'dave', password: 'generated-secret-value' }));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    await userEvent.type(screen.getByTestId('new-username'), 'dave');
    await userEvent.click(screen.getByTestId('create-user'));

    // No password field: the server generates it.
    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(testSession.accessToken, 'dave', false)
    );
    expect(await screen.findByTestId('generated-password')).toHaveValue(
      'generated-secret-value'
    );

    await userEvent.click(screen.getByTestId('dismiss-password'));
    await waitFor(() =>
      expect(screen.queryByTestId('generated-password')).not.toBeInTheDocument()
    );
  });

  it('can create an administrator', async () => {
    const createUser = jest
      .spyOn(authApi, 'createUser')
      .mockResolvedValue(Ok({ username: 'root2', password: 'pw' }));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    await userEvent.type(screen.getByTestId('new-username'), 'root2');
    await userEvent.click(screen.getByTestId('new-is-admin'));
    await userEvent.click(screen.getByTestId('create-user'));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(testSession.accessToken, 'root2', true)
    );
  });

  it('will not submit a blank username', async () => {
    const createUser = jest.spyOn(authApi, 'createUser');
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    expect(screen.getByTestId('create-user')).toBeDisabled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('disables an account', async () => {
    const setDisabled = jest
      .spyOn(authApi, 'setUserDisabled')
      .mockResolvedValue(Ok(undefined));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    await userEvent.click(screen.getByTestId('toggle-disabled-bob'));

    await waitFor(() =>
      expect(setDisabled).toHaveBeenCalledWith(testSession.accessToken, 'bob', true)
    );
  });

  it('re-enables a disabled account', async () => {
    const setDisabled = jest
      .spyOn(authApi, 'setUserDisabled')
      .mockResolvedValue(Ok(undefined));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    await userEvent.click(screen.getByTestId('toggle-disabled-carol'));

    await waitFor(() =>
      expect(setDisabled).toHaveBeenCalledWith(testSession.accessToken, 'carol', false)
    );
  });

  it('offers no way to disable yourself', async () => {
    // The server rejects it too; leaving the button out avoids an obvious foot-gun that
    // would leave nobody able to undo it.
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    expect(screen.queryByTestId(`toggle-disabled-${TEST_USER}`)).not.toBeInTheDocument();
    expect(screen.getByTestId(`user-row-${TEST_USER}`)).toHaveTextContent(/that's you/i);
  });

  it('surfaces a rejected creation', async () => {
    jest
      .spyOn(authApi, 'createUser')
      .mockResolvedValue(Err(InvalidArgumentError('That username is already taken')));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    await userEvent.type(screen.getByTestId('new-username'), 'bob');
    await userEvent.click(screen.getByTestId('create-user'));

    expect(await screen.findByTestId('admin-error')).toHaveTextContent(/already taken/i);
  });

  it('surfaces a rejected disable', async () => {
    jest
      .spyOn(authApi, 'setUserDisabled')
      .mockResolvedValue(Err(PermissionDeniedError('Not permitted')));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    await userEvent.click(screen.getByTestId('toggle-disabled-bob'));

    expect(await screen.findByTestId('admin-error')).toHaveTextContent(/not permitted/i);
  });
});

describe('AdminView sessions and tokens', () => {
  const tokens = [
    {
      id: 1,
      username: TEST_USER,
      kind: 'Access',
      label: null,
      identity: null,
      created_at: 0,
      expires_at: 100,
    },
    {
      id: 2,
      username: 'bob',
      kind: 'Api',
      label: 'cat_fox_owl',
      identity: null,
      created_at: 0,
      expires_at: null,
    },
    {
      id: 3,
      username: 'bob',
      kind: 'Bot',
      label: 'bob--cat_fox_owl',
      identity: 'bob--cat_fox_owl',
      created_at: 0,
      expires_at: null,
    },
  ];

  beforeEach(() => {
    useStubApi();
    setActiveSession(testSession);
    jest.restoreAllMocks();
    jest.spyOn(authApi, 'listUsers').mockResolvedValue(Ok(users));
    jest.spyOn(authApi, 'listAllTokens').mockResolvedValue(Ok(tokens));
  });

  it('lists every credential across all users', async () => {
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    expect(screen.getByTestId('token-row-1')).toHaveTextContent(TEST_USER);
    expect(screen.getByTestId('token-row-2')).toHaveTextContent('bob');
    expect(screen.getByTestId('token-row-3')).toHaveTextContent('bob--cat_fox_owl');
  });

  it('names the kinds the way an operator would', async () => {
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    // The wire values are Rust enum names; "Access" means a live login.
    expect(screen.getByTestId('token-row-1')).toHaveTextContent('Session');
    expect(screen.getByTestId('token-row-2')).toHaveTextContent('API token');
    expect(screen.getByTestId('token-row-3')).toHaveTextContent('Bot');
  });

  it("revokes another user's session", async () => {
    const revoke = jest
      .spyOn(authApi, 'adminRevokeToken')
      .mockResolvedValue(Ok(undefined));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    await userEvent.click(screen.getByTestId('revoke-token-2'));

    // Ownership is deliberately not a constraint here: cutting off someone else's
    // compromised credential is the whole point of the console.
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith(testSession.accessToken, 2)
    );
  });

  it('surfaces a failed revoke', async () => {
    jest
      .spyOn(authApi, 'adminRevokeToken')
      .mockResolvedValue(Err(PermissionDeniedError('Not permitted')));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    await userEvent.click(screen.getByTestId('revoke-token-1'));

    expect(await screen.findByTestId('admin-error')).toHaveTextContent(/not permitted/i);
  });

  it('refreshes the token list after disabling an account', async () => {
    const listAllTokens = jest.spyOn(authApi, 'listAllTokens').mockResolvedValue(Ok(tokens));
    jest.spyOn(authApi, 'setUserDisabled').mockResolvedValue(Ok(undefined));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    const before = listAllTokens.mock.calls.length;
    await userEvent.click(screen.getByTestId('toggle-disabled-bob'));

    // Disabling revokes that account's tokens, so a stale list would show sessions that
    // no longer work.
    await waitFor(() =>
      expect(listAllTokens.mock.calls.length).toBeGreaterThan(before)
    );
  });

  it('says so when there is nothing to show', async () => {
    jest.spyOn(authApi, 'listAllTokens').mockResolvedValue(Ok([]));
    await renderWithProvidersAsync(<AdminView username={TEST_USER} />);

    expect(screen.getByTestId('no-tokens')).toBeInTheDocument();
  });
});
