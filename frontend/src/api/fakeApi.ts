import { type Result, Ok, Err } from 'standard-ts-lib/src/result';
import { StatusError, NotFoundError } from 'standard-ts-lib/src/status_error';

export interface BugMetadata {
  reporter: string;
  type: string;
  priority: string;
  severity: string;
  status: string;
  assignee: string;
}

export interface Comment {
  author: string;
  epochNanoseconds: bigint;
  content: string;
}

export interface Bug {
  id: string;
  title: string;
  folders: string[];
  metadata: BugMetadata;
  comments: Comment[];
}

export interface BugSummary {
  id: string;
  title: string;
}

const mockBugs: Bug[] = [
  {
    id: "423673307",
    title: "Bumping gradle from 8.11.x to higher major versions causes androidTest compile failures",
    folders: ["Android Public Tracker", "App Development", "Jetpack (androidx)"],
    metadata: {
      reporter: "ch...@kivra.com",
      type: "Bug",
      priority: "P3",
      severity: "S3",
      status: "Assigned",
      assignee: "an...@google.com"
    },
    comments: [
      {
        author: "ch...@kivra.com",
        epochNanoseconds: 1718016000000000000n, // Jun 10, 2024 12:00AM
        content: `### DESCRIPTION
1. Describe the bug or issue that you're seeing.
Compiling androidTest fails when upgrading from 8.11.x to 8.12 or higher. Same failure in both Android Studio and my terminal command.

\`\`\`
Execution failed for task ':app:kspDebugAndroidTestKotlin'.
> Could not resolve all files for configuration ':app:debugAndroidTestCompileClasspath'.
   > Could not find androidx.annotation:annotation:.
\`\`\`
`
      },
      {
        author: "an...@google.com",
        epochNanoseconds: 1718100000000000000n, // Jun 11, 2024 10:00AM
        content: "We are looking into this. It seems like a dependency resolution issue with the new Gradle version."
      },
      {
        author: "abigale@google.com",
        epochNanoseconds: 1718103600000000000n, // Jun 11, 2024 11:00AM
        content: "kk, looks good."
      }
    ]
  }
];

export const fakeApi = {
  get_bug_list: async (): Promise<Result<BugSummary[], StatusError>> => {
    return Ok(mockBugs.map(b => ({ id: b.id, title: b.title })));
  },
  get_bug: async (id: string): Promise<Result<Bug, StatusError>> => {
    const bug = mockBugs.find(b => b.id === id);
    if (bug) {
      return Ok(bug);
    }
    return Err(NotFoundError(`Bug with id ${id} not found`));
  }
};
