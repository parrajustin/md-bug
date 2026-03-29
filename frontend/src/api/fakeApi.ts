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
  date: string;
  content: string;
}

export interface Bug {
  id: string;
  title: string;
  folders: string[];
  metadata: BugMetadata;
  comments: Comment[];
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
        date: "Jun 10, 2025 12:00AM",
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
        date: "Jun 11, 2025 10:00AM",
        content: "We are looking into this. It seems like a dependency resolution issue with the new Gradle version."
      }
    ]
  }
];

export const fakeApi = {
  get_bug_list: async () => {
    return mockBugs.map(b => ({ id: b.id, title: b.title }));
  },
  get_bug: async (id: string) => {
    return mockBugs.find(b => b.id === id) || null;
  }
};
