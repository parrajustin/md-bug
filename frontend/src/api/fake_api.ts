import { type Result, Ok, Err } from 'standard-ts-lib/src/result';
import { StatusError, NotFoundError } from 'standard-ts-lib/src/status_error';
import type { API, Bug, BugSummary, ComponentSummary, ChangeMetadataResponse, SubmitCommentResponse, BugStateResponse, ComponentMetadata, BugTemplate, CreateComponentRequest, CreateBugRequest, Permission, TemplateAccess } from './api';

export class FakeApi implements API {
  private mockBugs: Bug[] = [
    {
      id: 423673307,
      title: "Bumping gradle from 8.11.x to higher major versions causes androidTest compile failures",
      folders: ["Android Public Tracker", "App Development", "Jetpack (androidx)"],
      folder_ids: [3, 2, 1],
      metadata: {
        version: 1,
        id: 423673307,
        reporter: "ch...@kivra.com",
        type: "Bug",
        priority: "P3",
        severity: "S3",
        status: "Assigned",
        assignee: "an...@google.com",
        verifier: "ve...@google.com",
        collaborators: ["co...@google.com", "he...@google.com"],
        cc: ["cc...@google.com"],
        access: {
          version: 1,
          full_access: ["an...@google.com"],
          comment_access: ["ch...@kivra.com"],
          view_access: []
        },
        title: "Bumping gradle from 8.11.x to higher major versions causes androidTest compile failures",
        component_id: 1,
        description: "Compiling androidTest fails when upgrading from 8.11.x to 8.12 or higher. This seems to be related to the new dependency resolution engine.",
        user_metadata: [
          { version: 1, key: "Hotlist", value: "AndroidGradlePlugin", type: "string" },
          { version: 1, key: "Component ID", value: "192731", type: "string" }
        ],
        created_at: 1718016000000000000n,
        state_id: 1n
      },
      comments: [
        {
          version: 1,
          id: 1,
          author: "ch...@kivra.com",
          epoch_nanoseconds: 1718016000000000000n,
          content: "Compiling androidTest fails when upgrading from 8.11.x to 8.12 or higher."
        }
      ],
      state_id: 1n
    }
  ];

  async get_bug_list(username: string, query?: string): Promise<Result<BugSummary[], StatusError>> {
    let bugs = this.mockBugs;
    if (query) {
      const q = query.toLowerCase();
      bugs = bugs.filter(b => b.title.toLowerCase().includes(q));
    }
    return Ok(bugs.map(b => ({ id: b.id, title: b.title })));
  }

  async get_bug(username: string, id: number): Promise<Result<Bug, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    if (bug.metadata.state_id === undefined) bug.metadata.state_id = 1n;
    bug.state_id = bug.metadata.state_id;
    return Ok(bug);
  }

  async get_bug_state(username: string, id: number): Promise<Result<BugStateResponse, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    return Ok({ state_id: bug.state_id });
  }

  async submit_comment(username: string, id: number, author: string, content: string): Promise<Result<SubmitCommentResponse, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    const newId = bug.comments.length + 1;
    bug.metadata.state_id = (bug.metadata.state_id || 1n) + 1n;
    bug.state_id = bug.metadata.state_id;
    bug.comments.push({
      version: 1,
      id: newId,
      author,
      content,
      epoch_nanoseconds: BigInt(Date.now()) * 1000000n
    });
    return Ok({
      comment_id: newId,
      state_id: bug.metadata.state_id
    });
  }

  async update_metadata(username: string, id: number, field: string, value: string): Promise<Result<ChangeMetadataResponse, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    bug.metadata.state_id = (bug.metadata.state_id || 1n) + 1n;
    bug.state_id = bug.metadata.state_id;
    
    const m = bug.metadata as any;
    if (field in m) {
      m[field] = value;
    } else {
      const entry = bug.metadata.user_metadata.find(e => e.key === field);
      if (entry) entry.value = value;
      else bug.metadata.user_metadata.push({ version: 1, key: field, value, type: 'string' });
    }
    return Ok({
      state_id: bug.metadata.state_id
    });
  }

  async update_bug_access(username: string, id: number, mode: TemplateAccess): Promise<Result<ChangeMetadataResponse, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    bug.metadata.state_id = (bug.metadata.state_id || 1n) + 1n;
    bug.state_id = bug.metadata.state_id;
    // Mocking access update
    if (mode === 'LimitedComment') {
      bug.metadata.access.comment_access = ['PUBLIC'];
    } else if (mode === 'LimitedView') {
      bug.metadata.access.view_access = ['PUBLIC'];
    } else {
      bug.metadata.access.comment_access = [];
      bug.metadata.access.view_access = [];
    }
    return Ok({
      state_id: bug.metadata.state_id
    });
  }

  async get_component_metadata(username: string, id: number): Promise<Result<ComponentMetadata, StatusError>> {
    return Ok({
      version: 1,
      id,
      name: "Mock Component",
      description: `Description for component ${id}`,
      creator: "admin@example.com",
      bug_type: "Bug",
      priority: "P2",
      severity: "S2",
      collaborators: [],
      cc: [],
      access_control: {
        groups: {
          "Component Admins": {
            permissions: ["ComponentAdmin", "ViewIssues"] as Permission[],
            view_level: 999,
            members: ["admin@example.com"]
          }
        }
      },
      templates: {
        "": {
          name: "",
          description: "",
          title: "",
          collaborators: [],
          cc: [],
          default_access: "Default" as TemplateAccess
        }
      },
      default_template: "",
      user_metadata: [],
      created_at: 1718016000000000000n
    });
  }

  async get_component_list(username: string): Promise<Result<ComponentSummary[], StatusError>> {
    const components: ComponentSummary[] = [
      {
        id: 1,
        name: "Jetpack (androidx)",
        description: "Android Jetpack components",
        folders: ["Android Public Tracker", "App Development"],
        parent_id: 2
      },
      {
        id: 2,
        name: "App Development",
        description: "App development related issues",
        folders: ["Android Public Tracker"],
        parent_id: 3
      },
      {
        id: 3,
        name: "Android Public Tracker",
        description: "Public tracker for Android",
        folders: [],
        parent_id: 0
      }
    ];
    return Ok(components);
  }

  async update_component_metadata(username: string, id: number, metadata: ComponentMetadata): Promise<Result<void, StatusError>> {
    return Ok(undefined);
  }

  async add_template(username: string, id: number, template: BugTemplate): Promise<Result<void, StatusError>> {
    return Ok(undefined);
  }

  async modify_template(username: string, id: number, old_name: string, template: BugTemplate): Promise<Result<void, StatusError>> {
    return Ok(undefined);
  }

  async delete_template(username: string, id: number, name: string): Promise<Result<void, StatusError>> {
    return Ok(undefined);
  }

  async create_component(username: string, request: CreateComponentRequest): Promise<Result<void, StatusError>> {
    return Ok(undefined);
  }

  async create_bug(username: string, request: CreateBugRequest): Promise<Result<number, StatusError>> {
    return Ok(Math.floor(Math.random() * 1000000));
  }
}

export const fakeApi = new FakeApi();
