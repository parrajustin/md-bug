import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const BACKEND_BINARY = path.resolve(__dirname, '../backend/target/debug/md-bug-backend');
const CLI_BINARY = path.resolve(__dirname, '../backend/target/debug/md-bug-cli');
const TEST_ROOT = path.resolve(__dirname, 'remote-cli-test-data');
const PORT = 9005;
const REMOTE_ADDR = `localhost:${PORT}`;

function runCli(args: string[]): { status: number | null, stdout: string, stderr: string } {
    console.log(`\n--- RUNNING CLI (REMOTE) ---`);
    console.log(`Command: ${args.join(' ')}`);
    // Note: No --root flag here, just --remote
    const result = spawnSync(CLI_BINARY, ['--remote', REMOTE_ADDR, ...args], { encoding: 'utf8' });
    if (result.stdout) {
        console.log(`STDOUT:\n${result.stdout}`);
    }
    if (result.stderr) {
        console.log(`STDERR:\n${result.stderr}`);
    }
    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr
    };
}

function runBackendCommand(args: string[]): void {
    const result = spawnSync(BACKEND_BINARY, ['--root', TEST_ROOT, ...args], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`Backend command failed: ${args.join(' ')}\n${result.stderr}`);
    }
}

describe('md-bug-cli Remote Integration Tests', () => {
    let backendProcess: ChildProcess | null = null;

    async function startBackend() {
        return new Promise<void>((resolve, reject) => {
            backendProcess = spawn(BACKEND_BINARY, [
                '--root', TEST_ROOT,
                '--port', PORT.toString(),
                '--frontend-dir', path.resolve(__dirname, '../frontend/public')
            ]);
            backendProcess.stdout?.on('data', (data: Buffer) => {
                if (data.toString().includes('listening on')) resolve();
            });
            backendProcess.stderr?.on('data', (data: Buffer) => {
                // Useful for debugging
                // console.error(`Backend stderr: ${data}`);
            });
            backendProcess.on('error', reject);
        });
    }

    async function stopBackend() {
        if (backendProcess) {
            backendProcess.kill();
            await new Promise(resolve => backendProcess!.on('exit', resolve));
            backendProcess = null;
        }
    }

    beforeAll(async () => {
        if (fs.existsSync(TEST_ROOT)) {
            fs.rmSync(TEST_ROOT, { recursive: true, force: true });
        }
        fs.mkdirSync(TEST_ROOT, { recursive: true });

        // Bootstrap root components locally first
        runBackendCommand(['--CreateRootComponent', 'RemoteTest', '--AdminUserId', 'admin']);
        
        // Start the server
        await startBackend();
    }, 60000);

    afterAll(async () => {
        await stopBackend();
        if (fs.existsSync(TEST_ROOT)) {
            fs.rmSync(TEST_ROOT, { recursive: true, force: true });
        }
    });

    it('should list components via --remote', async () => {
        const res = runCli(['--component_list', '{"u": "admin"}']);
        expect(res.status).toBe(0);
        const data = JSON.parse(res.stdout);
        expect(Array.isArray(data)).toBe(true);
        expect(data.some((c: any) => c.name === 'RemoteTest')).toBe(true);
    });

    let componentId: number;
    it('should create a component via --remote', async () => {
        const listResBefore = runCli(['--component_list', '{"u": "admin"}']);
        const rootComp = JSON.parse(listResBefore.stdout).find((c: any) => c.name === 'RemoteTest');
        const rootId = rootComp.id;

        const compRequest = {
            u: "admin",
            name: "Remote_Sub",
            description: "Created via remote CLI",
            parent_id: rootId
        };
        const createRes = runCli(['--create_component', JSON.stringify(compRequest)]);
        expect(createRes.status).toBe(0);

        // Verify via list
        const listResAfter = runCli(['--component_list', '{"u": "admin"}']);
        const list = JSON.parse(listResAfter.stdout);
        const subComp = list.find((c: any) => c.name === 'Remote_Sub');
        expect(subComp).toBeDefined();
        componentId = subComp.id;
    });

    let bugId: number;
    it('should create a bug via --remote', async () => {
        const bugReq = {
            u: "admin",
            component_id: componentId,
            template_name: "",
            title: "Remote Bug",
            description: "Bug created over remote CLI",
            collaborators: [],
            cc: []
        };
        const createRes = runCli(['--create_bug', JSON.stringify(bugReq)]);
        expect(createRes.status).toBe(0);
        bugId = parseInt(createRes.stdout);
        expect(bugId).toBeGreaterThan(0);
    });

    it('should get bug details via --remote', async () => {
        const getRes = runCli(['--bug', bugId.toString(), '--get_bug', '{"u": "admin"}']);
        expect(getRes.status).toBe(0);
        const bug = JSON.parse(getRes.stdout);
        expect(bug.title).toBe("Remote Bug");
        expect(bug.metadata.description).toBe("Bug created over remote CLI");
    });

    it('should submit a comment via --remote', async () => {
        const commentReq = {
            author: "admin",
            content: "Remote comment",
            u: "admin"
        };
        const res = runCli(['--bug', bugId.toString(), '--submit_comment', JSON.stringify(commentReq)]);
        expect(res.status).toBe(0);
        const data = JSON.parse(res.stdout);
        expect(data.comment_id).toBeDefined();

        // Verify bug now has the comment
        const getRes = runCli(['--bug', bugId.toString(), '--get_bug', '{"u": "admin"}']);
        const bug = JSON.parse(getRes.stdout);
        expect(bug.comments.some((c: any) => c.content === "Remote comment")).toBe(true);
    });
});
