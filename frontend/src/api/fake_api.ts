import { type Result, Ok, Err } from 'standard-ts-lib/src/result';
import { StatusError, NotFoundError } from 'standard-ts-lib/src/status_error';
import type { API, Bug, BugSummary } from './api';

export class FakeApi implements API {
  private mockBugs: Bug[] = [
    {
      id: 423673307,
      title: "Bumping gradle from 8.11.x to higher major versions causes androidTest compile failures",
      folders: ["Android Public Tracker", "App Development", "Jetpack (androidx)"],
      metadata: {
        id: 423673307,
        reporter: "ch...@kivra.com",
        type: "Bug",
        priority: "P3",
        severity: "S3",
        status: "Assigned",
        assignee: "an...@google.com",
        title: "Bumping gradle from 8.11.x to higher major versions causes androidTest compile failures",
        folders: ["Android Public Tracker", "App Development", "Jetpack (androidx)"],
        description: "Compiling androidTest fails when upgrading from 8.11.x to 8.12 or higher. This seems to be related to the new dependency resolution engine.",
        userMetadata: [
          { key: "Hotlist", value: "AndroidGradlePlugin", type: "string" },
          { key: "Component ID", value: "192731", type: "string" }
        ],
        createdAt: 1718016000000000000n
      },
      comments: [
        {
          id: 1,
          author: "ch...@kivra.com",
          epochNanoseconds: 1718016000000000000n,
          content: "Compiling androidTest fails when upgrading from 8.11.x to 8.12 or higher."
        }
      ]
    }
  ];

  async get_bug_list(query?: string): Promise<Result<BugSummary[], StatusError>> {
    let bugs = this.mockBugs;
    if (query) {
      const q = query.toLowerCase();
      bugs = bugs.filter(b => b.title.toLowerCase().includes(q));
    }
    return Ok(bugs.map(b => ({ id: b.id, title: b.title })));
  }

  async get_bug(id: number): Promise<Result<Bug, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    return bug ? Ok(bug) : Err(NotFoundError(`Bug ${id} not found`));
  }

  async submit_comment(id: number, author: string, content: string): Promise<Result<number, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    const newId = bug.comments.length + 1;
    bug.comments.push({
      id: newId,
      author,
      content,
      epochNanoseconds: BigInt(Date.now()) * 1000000n
    });
    return Ok(newId);
  }

  async change_metadata(id: number, field: string, value: string): Promise<Result<void, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    const m = bug.metadata as any;
    if (field in m) {
      m[field] = value;
    } else {
      const entry = bug.metadata.userMetadata.find(e => e.key === field);
      if (entry) entry.value = value;
      else bug.metadata.userMetadata.push({ key: field, value, type: 'string' });
    }
    return Ok(undefined);
  }
}

export const fakeApi = new FakeApi();
