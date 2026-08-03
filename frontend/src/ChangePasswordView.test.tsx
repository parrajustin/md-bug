import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Ok, Err } from 'standard-ts-lib/src/result';
import { UnauthenticatedError } from 'standard-ts-lib/src/status_error';
import ChangePasswordView from './ChangePasswordView';
import { authApi } from './api/auth_api';
import { renderWithProviders, useStubApi, TEST_USER } from './test/harness';

const fill = async (current: string, next: string, confirm: string) => {
  await userEvent.type(screen.getByTestId('current-password'), current);
  await userEvent.type(screen.getByTestId('new-password'), next);
  await userEvent.type(screen.getByTestId('confirm-password'), confirm);
  await userEvent.click(screen.getByTestId('change-password-submit'));
};

describe('ChangePasswordView', () => {
  beforeEach(() => {
    useStubApi();
    jest.restoreAllMocks();
  });

  it('renders all three password fields, masked', () => {
    renderWithProviders(
      <ChangePasswordView username={TEST_USER} forced onChanged={() => {}} />
    );

    for (const id of ['current-password', 'new-password', 'confirm-password']) {
      expect(screen.getByTestId(id)).toHaveAttribute('type', 'password');
    }
  });

  it('explains why the change is mandatory when forced', () => {
    renderWithProviders(
      <ChangePasswordView username={TEST_USER} forced onChanged={() => {}} />
    );

    expect(screen.getByTestId('forced-notice')).toBeInTheDocument();
    // A forced change has no way out; offering Cancel would be a dead end because the
    // backend 403s everything else.
    expect(screen.queryByTestId('change-password-cancel')).not.toBeInTheDocument();
  });

  it('offers Cancel only when the change is voluntary', () => {
    renderWithProviders(
      <ChangePasswordView
        username={TEST_USER}
        forced={false}
        onChanged={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.queryByTestId('forced-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('change-password-cancel')).toBeInTheDocument();
  });

  it('rejects a too-short password without calling the API', async () => {
    const change = jest.spyOn(authApi, 'changePassword');
    renderWithProviders(
      <ChangePasswordView username={TEST_USER} forced onChanged={() => {}} />
    );

    await fill('old-password', 'short', 'short');

    expect(await screen.findByTestId('change-password-error')).toHaveTextContent(
      /at least 8/i
    );
    expect(change).not.toHaveBeenCalled();
  });

  it('rejects mismatched confirmation without calling the API', async () => {
    const change = jest.spyOn(authApi, 'changePassword');
    renderWithProviders(
      <ChangePasswordView username={TEST_USER} forced onChanged={() => {}} />
    );

    await fill('old-password', 'brand-new-password', 'brand-new-passward');

    expect(await screen.findByTestId('change-password-error')).toHaveTextContent(
      /do not match/i
    );
    expect(change).not.toHaveBeenCalled();
  });

  it('rejects reusing the current password', async () => {
    const change = jest.spyOn(authApi, 'changePassword');
    renderWithProviders(
      <ChangePasswordView username={TEST_USER} forced onChanged={() => {}} />
    );

    await fill('same-password-99', 'same-password-99', 'same-password-99');

    expect(await screen.findByTestId('change-password-error')).toHaveTextContent(
      /different/i
    );
    expect(change).not.toHaveBeenCalled();
  });

  it('submits a valid change and notifies the caller', async () => {
    const change = jest
      .spyOn(authApi, 'changePassword')
      .mockResolvedValue(Ok(undefined));
    const onChanged = jest.fn();
    renderWithProviders(
      <ChangePasswordView username={TEST_USER} forced onChanged={onChanged} />
    );

    await fill('generated-pw', 'my-own-password', 'my-own-password');

    await waitFor(() =>
      expect(change).toHaveBeenCalledWith(TEST_USER, 'generated-pw', 'my-own-password')
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('surfaces a wrong current password and stays put', async () => {
    jest
      .spyOn(authApi, 'changePassword')
      .mockResolvedValue(Err(UnauthenticatedError('Incorrect username or password')));
    const onChanged = jest.fn();
    renderWithProviders(
      <ChangePasswordView username={TEST_USER} forced onChanged={onChanged} />
    );

    await fill('wrong-current', 'my-own-password', 'my-own-password');

    expect(await screen.findByTestId('change-password-error')).toHaveTextContent(
      /incorrect/i
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
