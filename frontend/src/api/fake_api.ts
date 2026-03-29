import { type Result, Ok, Err } from 'standard-ts-lib/src/result';
import { StatusError, NotFoundError } from 'standard-ts-lib/src/status_error';
import type { API, Bug, BugSummary, ChangeMetadataResponse, SubmitCommentResponse } from './api';

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
        createdAt: 1718016000000000000n,
        stateId: 1n
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
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    if (bug.metadata.stateId === undefined) bug.metadata.stateId = 1n;
    return Ok(bug);
  }

  async submit_comment(id: number, author: string, content: string): Promise<Result<SubmitCommentResponse, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    const newId = bug.comments.length + 1;
    bug.metadata.stateId = (bug.metadata.stateId || 1n) + 1n;
    bug.comments.push({
      id: newId,
      author,
      content,
      epochNanoseconds: BigInt(Date.now()) * 1000000n
    });
    return Ok({
      commentId: newId,
      stateId: bug.metadata.stateId
    });
  }

  async change_metadata(id: number, field: string, value: string): Promise<Result<ChangeMetadataResponse, StatusError>> {
    const bug = this.mockBugs.find(b => b.id === id);
    if (!bug) return Err(NotFoundError(`Bug ${id} not found`));
    bug.metadata.stateId = (bug.metadata.stateId || 1n) + 1n;
    const m = bug.metadata as any;
    if (field in m) {
      m[field] = value;
    } else {
      const entry = bug.metadata.userMetadata.find(e => e.key === field);
      if (entry) entry.value = value;
      else bug.metadata.userMetadata.push({ key: field, value, type: 'string' });
    }
    return Ok({
      stateId: bug.metadata.stateId
    });
  }
}

export const fakeApi = new FakeApi();
