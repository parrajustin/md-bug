import React from 'react';
import { act, render, type RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { Ok, Err, type Result } from 'standard-ts-lib/src/result';
import { NotFoundError, type StatusError } from 'standard-ts-lib/src/status_error';
import { theme } from '../theme';
import {
  inject_api,
  type API,
  type Bug,
  type BugSummary,
  type BugStateResponse,
  type BugTemplate,
  type ChangeMetadataResponse,
  type ComponentMetadata,
  type ComponentSummary,
  type CreateBugRequest,
  type CreateComponentRequest,
  type CreateRootComponentRequest,
  type SubmitCommentResponse,
} from '../api/api';

export const TEST_USER = 'test_user';

/// A ready-made session for tests that need the app past the login screen.
export const testSession = {
  accessToken: 'mdb_at_1.test-access-secret',
  refreshToken: 'mdb_rt_1.test-refresh-secret',
  username: TEST_USER,
  isAdmin: false,
};

export const testBug: Bug = {
  id: 42,
  title: 'Widget fails to render on first paint',
  folders: ['root', 'frontend'],
  folder_ids: [1, 2],
  metadata: {
    version: 1,
    id: 42,
    reporter: 'reporter@example.com',
    type: 'Bug',
    priority: 'P2',
    severity: 'S2',
    status: 'Assigned',
    assignee: 'assignee@example.com',
    verifier: 'verifier@example.com',
    collaborators: ['collab@example.com'],
    cc: ['cc@example.com'],
    access: {
      version: 1,
      full_access: [TEST_USER],
      comment_access: [],
      view_access: [],
    },
    title: 'Widget fails to render on first paint',
    component_id: 2,
    description: 'The widget is **blank** until a resize event fires.',
    user_metadata: [{ version: 1, key: 'Hotlist', value: 'Rendering', type: 'string' }],
    created_at: 1718016000000000000n,
    state_id: 1n,
  },
  comments: [
    {
      version: 1,
      id: 1,
      author: 'reporter@example.com',
      epoch_nanoseconds: 1718016000000000000n,
      content: 'Reproduced on `main` with a cold cache.',
    },
  ],
  state_id: 1n,
};

export const testBugSummary: BugSummary = {
  id: testBug.id,
  title: testBug.title,
  description: testBug.metadata.description,
  status: testBug.metadata.status,
  priority: testBug.metadata.priority,
  severity: testBug.metadata.severity,
  type: testBug.metadata.type,
  created_at: testBug.metadata.created_at,
  last_updated_at: testBug.metadata.created_at,
};

export const testComponents: ComponentSummary[] = [
  { id: 1, name: 'root', description: 'Root component', folders: [], parent_id: 0 },
  { id: 2, name: 'frontend', description: 'UI code', folders: ['root'], parent_id: 1 },
];

export const testComponentMetadata: ComponentMetadata = {
  version: 1,
  id: 2,
  name: 'frontend',
  description: 'UI code',
  creator: TEST_USER,
  collaborators: [],
  cc: [],
  access_control: {
    groups: {
      'Component Admins': {
        permissions: ['ComponentAdmin'],
        view_level: 0,
        members: [TEST_USER],
      },
      'Issue Contributors': {
        permissions: ['CreateIssues', 'CommentOnIssues', 'ViewIssues'],
        view_level: 1,
        members: ['PUBLIC'],
      },
    },
  },
  templates: {},
  default_template: '',
  user_metadata: [],
  created_at: 1718016000000000000n,
};

/**
 * An in-memory API stub. Every method resolves successfully with the fixtures above;
 * pass `overrides` to change individual methods (e.g. to exercise an error branch).
 */
export function makeStubApi(overrides: Partial<API> = {}): API {
  const base: API = {
    get_bug_list: async (): Promise<Result<BugSummary[], StatusError>> => Ok([testBugSummary]),
    get_bug: async (id: number): Promise<Result<Bug, StatusError>> =>
      id === testBug.id ? Ok(testBug) : Err(NotFoundError(`No bug ${id}`)),
    get_bug_state: async (): Promise<Result<BugStateResponse, StatusError>> => Ok({ state_id: 1n }),
    submit_comment: async (): Promise<Result<SubmitCommentResponse, StatusError>> =>
      Ok({ comment_id: 2, state_id: 2n }),
    update_bug_metadata: async (): Promise<Result<ChangeMetadataResponse, StatusError>> =>
      Ok({ state_id: 2n }),
    get_component_metadata: async (): Promise<Result<ComponentMetadata, StatusError>> =>
      Ok(testComponentMetadata),
    update_component_metadata: async (): Promise<Result<void, StatusError>> => Ok(undefined),
    get_component_list: async (): Promise<Result<ComponentSummary[], StatusError>> =>
      Ok(testComponents),
    add_template: async (): Promise<Result<void, StatusError>> => Ok(undefined),
    modify_template: async (_i: number, _o: string, _t: BugTemplate) => Ok(undefined),
    delete_template: async (): Promise<Result<void, StatusError>> => Ok(undefined),
    create_component: async (_r: CreateComponentRequest) => Ok(undefined),
    create_root_component: async (_r: CreateRootComponentRequest): Promise<Result<number, StatusError>> =>
      Ok(7),
    create_bug: async (_r: CreateBugRequest): Promise<Result<number, StatusError>> => Ok(99),
  };
  return { ...base, ...overrides };
}

/** Installs a stub API for the current test and returns it. */
export function useStubApi(overrides: Partial<API> = {}): API {
  const api = makeStubApi(overrides);
  inject_api(api);
  return api;
}

/**
 * Renders `ui` inside the providers every view expects (router + MUI theme).
 *
 * Pass `path` for views that read `useParams` — without a matching <Route> the params
 * are empty and the view renders its "not found" branch instead of the real content.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  { route = '/', path }: { route?: string; path?: string } = {}
): RenderResult {
  const content = path ? <Routes><Route path={path} element={ui} /></Routes> : ui;
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {content}
      </ThemeProvider>
    </MemoryRouter>
  );
}

/**
 * Same as `renderWithProviders`, but flushes effects that resolve promises before
 * returning. Use this for any view whose useEffect awaits the API (most of them) —
 * otherwise the resulting setState lands outside act() and React logs a warning,
 * which `setup.ts` escalates into a failure.
 */
export async function renderWithProvidersAsync(
  ui: React.ReactElement,
  options: { route?: string; path?: string } = {}
): Promise<RenderResult> {
  let result: RenderResult | undefined;
  await act(async () => {
    result = renderWithProviders(ui, options);
  });
  return result as RenderResult;
}
