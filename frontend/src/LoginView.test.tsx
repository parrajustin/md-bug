import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LoginView from './LoginView';
import { authApi } from './api/auth_api';
import { Ok, Err } from 'standard-ts-lib/src/result';
import { UnauthenticatedError } from 'standard-ts-lib/src/status_error';
import { renderWithProviders, useStubApi, testSession } from './test/harness';

describe('LoginView', () => {
  beforeEach(() => {
    useStubApi();
    jest.restoreAllMocks();
  });

  it('renders username and password fields', () => {
    renderWithProviders(<LoginView onLogin={() => {}} />);

    expect(screen.getByTestId('login-username')).toBeInTheDocument();
    expect(screen.getByTestId('login-password')).toBeInTheDocument();
    expect(screen.getByTestId('login-submit')).toBeInTheDocument();
  });

  it('masks the password input', () => {
    renderWithProviders(<LoginView onLogin={() => {}} />);
    expect(screen.getByTestId('login-password')).toHaveAttribute('type', 'password');
  });

  it('requires a password before calling the API', async () => {
    const login = jest.spyOn(authApi, 'login');
    renderWithProviders(<LoginView onLogin={() => {}} />);

    await userEvent.type(screen.getByTestId('login-username'), 'admin');
    await userEvent.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-error')).toHaveTextContent(/password/i);
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in and reports the session', async () => {
    jest
      .spyOn(authApi, 'login')
      .mockResolvedValue(Ok({ session: testSession, mustChangePassword: false }));
    const onLogin = jest.fn();
    renderWithProviders(<LoginView onLogin={onLogin} />);

    await userEvent.type(screen.getByTestId('login-username'), 'admin');
    await userEvent.type(screen.getByTestId('login-password'), 'hunter2hunter2');
    await userEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(testSession, false));
  });

  it('propagates the forced-password-change flag', async () => {
    jest
      .spyOn(authApi, 'login')
      .mockResolvedValue(Ok({ session: testSession, mustChangePassword: true }));
    const onLogin = jest.fn();
    renderWithProviders(<LoginView onLogin={onLogin} />);

    await userEvent.type(screen.getByTestId('login-username'), 'admin');
    await userEvent.type(screen.getByTestId('login-password'), 'generated-pw');
    await userEvent.click(screen.getByTestId('login-submit'));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(testSession, true));
  });

  it('shows the server error on bad credentials and does not sign in', async () => {
    jest
      .spyOn(authApi, 'login')
      .mockResolvedValue(Err(UnauthenticatedError('Incorrect username or password')));
    const onLogin = jest.fn();
    renderWithProviders(<LoginView onLogin={onLogin} />);

    await userEvent.type(screen.getByTestId('login-username'), 'admin');
    await userEvent.type(screen.getByTestId('login-password'), 'wrong');
    await userEvent.click(screen.getByTestId('login-submit'));

    expect(await screen.findByTestId('login-error')).toHaveTextContent(/incorrect/i);
    expect(onLogin).not.toHaveBeenCalled();
  });
});
