import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Err } from 'standard-ts-lib/src/result';
import { NotFoundError } from 'standard-ts-lib/src/status_error';
import ComponentEditorView from './ComponentEditorView';
import {
  renderWithProvidersAsync,
  useStubApi,
  TEST_USER,
  testComponentMetadata,
} from './test/harness';

const renderEditor = () =>
  renderWithProvidersAsync(<ComponentEditorView username={TEST_USER} />, {
    route: '/component/2',
    path: '/component/:id',
  });

describe('ComponentEditorView', () => {
  it('renders the component metadata for the routed id', async () => {
    useStubApi();
    await renderEditor();

    expect(screen.getAllByText(new RegExp(testComponentMetadata.name, 'i')).length)
      .toBeGreaterThan(0);
  });

  it('renders the Sub-Components card header', async () => {
    // Regression guard: CardHeader used titleTypographyProps, removed in MUI 9.
    useStubApi();
    await renderEditor();

    expect(screen.getByText('Sub-Components')).toBeInTheDocument();
    expect(document.querySelector('[titletypographyprops]')).toBeNull();
  });

  it('renders the three editor tabs', async () => {
    useStubApi();
    await renderEditor();

    expect(screen.getByRole('tab', { name: 'Metadata' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Templates' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Access' })).toBeInTheDocument();
  });

  it('lists the permission groups on the Access tab', async () => {
    useStubApi();
    await renderEditor();

    await userEvent.click(screen.getByRole('tab', { name: 'Access' }));

    expect(screen.getAllByText(/Component Admins/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Issue Contributors/i).length).toBeGreaterThan(0);
  });

  it('handles a component that cannot be loaded', async () => {
    useStubApi({ get_component_metadata: async () => Err(NotFoundError('no such component')) });
    await renderEditor();

    expect(screen.getByText(/no such component/i)).toBeInTheDocument();
  });
});
