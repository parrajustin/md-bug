import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BackendApi } from '../frontend/src/api/backend_api';
import { bigIntReplacer } from '../frontend/src/api/api';

const BACKEND_BINARY = path.resolve(__dirname, '../backend/target/debug/md-bug-backend');
const CLI_BINARY = path.resolve(__dirname, '../backend/target/debug/md-bug-cli');
const TEST_ROOT = path.resolve(__dirname, 'cli-test-data');
const PORT = 9002;
const BACKEND_URL = `http://localhost:${PORT}`;

function runCli(args: string[]): { status: number | null, stdout: string, stderr: string } {
    console.log(`\n--- RUNNING CLI ---`);
    console.log(`Command: ${args.join(' ')}`);
    const result = spawnSync(CLI_BINARY, ['--root', TEST_ROOT, ...args], { encoding: 'utf8' });
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

describe('md-bug-cli Symmetrical Integration Tests', () => {
    let backendProcess: ChildProcess | null = null;
    let api: BackendApi;

    async function startBackend() {
        if (backendProcess) await stopBackend();
        return new Promise<void>((resolve, reject) => {
            backendProcess = spawn(BACKEND_BINARY, [
                '--root', TEST_ROOT,
                '--port', PORT.toString(),
                '--frontend-dir', path.resolve(__dirname, '../frontend/public')
            ]);
            backendProcess.stdout?.on('data', (data: Buffer) => {
                if (data.toString().includes('listening on')) resolve();
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

        // Bootstrap root components
        runBackendCommand(['--CreateRootComponent', 'All', '--AdminUserId', 'admin']);
        api = new BackendApi(BACKEND_URL);
    }, 30000);

    afterAll(async () => {
        await stopBackend();
        if (fs.existsSync(TEST_ROOT)) {
            fs.rmSync(TEST_ROOT, { recursive: true, force: true });
        }
    });

    let rootId: number;

    it('Symmetrical check: component_list (CLI vs API)', async () => {
        await startBackend();
        const cliRes = runCli(['--component_list', '{"u": "admin"}']);
        expect(cliRes.status).toBe(0);
        const cliData = JSON.parse(cliRes.stdout);

        const apiRes = await api.get_component_list('admin');
        expect(apiRes.ok).toBe(true);
        const apiData = JSON.parse(JSON.stringify(apiRes.unsafeUnwrap(), bigIntReplacer));

        expect(cliData).toEqual(apiData);
        rootId = cliData[0].id;
    });

    let cliCompId: number;
    it('Symmetrical check: create_component & get_component_metadata', async () => {
        const compRequest = {
            u: "admin",
            name: "Symmetry_Comp",
            description: "Symmetry Test",
            parent_id: rootId
        };
        const createRes = runCli(['--create_component', JSON.stringify(compRequest)]);
        expect(createRes.status).toBe(0);

        // Verification via CLI list
        const listRes = runCli(['--component_list', '{"u": "admin"}']);
        const list = JSON.parse(listRes.stdout);
        const comp = list.find((c: any) => c.name === 'Symmetry_Comp');
        expect(comp).toBeDefined();
        cliCompId = comp.id;

        // Verify via CLI get_component_metadata
        const getCliRes = runCli(['--component', cliCompId.toString(), '--get_component_metadata', '{"u": "admin"}']);
        expect(getCliRes.status).toBe(0);
        const cliMeta = JSON.parse(getCliRes.stdout);
        expect(cliMeta.name).toBe("Symmetry_Comp");

        // CROSS-VERIFY via API (restart needed to refresh cache)
        await startBackend();
        const getApiRes = await api.get_component_metadata('admin', cliCompId);
        expect(getApiRes.ok).toBe(true);
        const apiMeta = JSON.parse(JSON.stringify(getApiRes.unsafeUnwrap(), bigIntReplacer));
        expect(apiMeta.name).toBe("Symmetry_Comp");
        expect(cliMeta).toEqual(apiMeta);
    });

    it('Symmetrical check: update_component_metadata', async () => {
        const getRes = runCli(['--component', cliCompId.toString(), '--get_component_metadata', '{"u": "admin"}']);
        const meta = JSON.parse(getRes.stdout);
        meta.description = "Symmetrical update";

        const updateRes = runCli([
            '--component', cliCompId.toString(),
            '--update_component_metadata',
            JSON.stringify({ u: "admin", metadata: meta })
        ]);
        expect(updateRes.status).toBe(0);

        // Verify via API
        await startBackend();
        const apiRes = await api.get_component_metadata('admin', cliCompId);
        expect(apiRes.unsafeUnwrap().description).toBe("Symmetrical update");
    });

    it('Symmetrical check: templates (add, modify, delete)', async () => {
        const template = {
            name: "Sym_Temp",
            description: "Desc",
            title: "Title",
            collaborators: [],
            cc: [],
            default_access: "Default"
        };

        // Add
        runCli(['--component', cliCompId.toString(), '--add_template', JSON.stringify({ u: "admin", template })]);
        await startBackend();
        let apiMeta = (await api.get_component_metadata('admin', cliCompId)).unsafeUnwrap();
        expect(apiMeta.templates["Sym_Temp"]).toBeDefined();

        // Modify
        template.description = "Modified Sym";
        runCli(['--component', cliCompId.toString(), '--modify_template', JSON.stringify({ u: "admin", old_name: "Sym_Temp", template })]);
        await startBackend();
        apiMeta = (await api.get_component_metadata('admin', cliCompId)).unsafeUnwrap();
        expect(apiMeta.templates["Sym_Temp"].description).toBe("Modified Sym");

        // Delete
        runCli(['--component', cliCompId.toString(), '--delete_template', JSON.stringify({ u: "admin", name: "Sym_Temp" })]);
        await startBackend();
        apiMeta = (await api.get_component_metadata('admin', cliCompId)).unsafeUnwrap();
        expect(apiMeta.templates["Sym_Temp"]).toBeUndefined();
    });

    let bugId: number;
    it('Symmetrical check: create_bug & get_bug', async () => {
        const bugReq = {
            u: "admin",
            component_id: cliCompId,
            template_name: "",
            title: "Symmetry Bug",
            description: "Symmetry Bug Desc",
            collaborators: [],
            cc: []
        };
        const createRes = runCli(['--create_bug', JSON.stringify(bugReq)]);
        expect(createRes.status).toBe(0);
        bugId = parseInt(createRes.stdout);

        // Verify via CLI
        const getCliRes = runCli(['--bug', bugId.toString(), '--get_bug', '{"u": "admin"}']);
        const cliBug = JSON.parse(getCliRes.stdout);
        expect(cliBug.title).toBe("Symmetry Bug");

        // Verify via API
        await startBackend();
        const apiRes = await api.get_bug('admin', bugId);
        expect(apiRes.ok).toBe(true);
        const apiBug = JSON.parse(JSON.stringify(apiRes.unsafeUnwrap(), bigIntReplacer));
        expect(cliBug).toEqual(apiBug);
    });

    it('Symmetrical check: submit_comment', async () => {
        const commentReq = {
            author: "admin",
            content: "Symmetry Comment",
            u: "admin"
        };
        const res = runCli(['--bug', bugId.toString(), '--submit_comment', JSON.stringify(commentReq)]);
        expect(res.status).toBe(0);
        const data = JSON.parse(res.stdout);

        // Verify via API
        await startBackend();
        const apiBug = (await api.get_bug('admin', bugId)).unsafeUnwrap();
        const comment = apiBug.comments.find(c => c.id === data.comment_id);
        expect(comment?.content).toBe("Symmetry Comment");
    });

    it('Symmetrical check: update_bug_metadata', async () => {
        const updateReq = {
            field: "status",
            value: "Symmetrical_Fixed",
            u: "admin"
        };
        const res = runCli(['--bug', bugId.toString(), '--update_bug_metadata', JSON.stringify(updateReq)]);
        expect(res.status).toBe(0);

        // Verify via API
        await startBackend();
        const apiBug = (await api.get_bug('admin', bugId)).unsafeUnwrap();
        expect(apiBug.metadata.status).toBe("Symmetrical_Fixed");
    });
});
