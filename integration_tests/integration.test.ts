import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BackendApi } from '../frontend/src/api/backend_api';
import { CreateBugRequest, ComponentMetadata, Permission, bigIntReplacer } from '../frontend/src/api/api';

const BINARY_PATH = path.resolve(__dirname, '../backend/target/debug/md-bug-backend');
const FRONTEND_DIR = path.resolve(__dirname, '../frontend/public');
const TEST_ROOT = path.resolve(__dirname, 'test-data');
const PORT = 9001;
const BACKEND_URL = `http://localhost:${PORT}`;

describe('Integration Test', () => {
  let backendProcess: ChildProcess;

  beforeAll(async () => {
    // 1. Build backend
    console.log('Building backend...');
    await runCommand('cargo build', path.resolve(__dirname, '../backend'));

    // 2. Setup test root
    if (fs.existsSync(TEST_ROOT)) {
      fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
    fs.mkdirSync(TEST_ROOT, { recursive: true });

    // 3. Create root components via binary
    console.log('Creating root components...');
    await runCommand(`${BINARY_PATH} --root ${TEST_ROOT} --CreateRootComponent="Admin" --AdminUserId="admin"`);
    await runCommand(`${BINARY_PATH} --root ${TEST_ROOT} --CreateRootComponent="all" --AdminUserId="admin"`);
  }, 60000);

  afterAll(async () => {
    if (backendProcess) {
      backendProcess.kill();
    }
    if (fs.existsSync(TEST_ROOT)) {
      // fs.rmSync(TEST_ROOT, { recursive: true, force: true });
    }
  });

  async function startBackend() {
    return new Promise<void>((resolve, reject) => {
      backendProcess = spawn(BINARY_PATH, [
        '--root', TEST_ROOT,
        '--port', PORT.toString(),
        '--frontend-dir', FRONTEND_DIR
      ]);

      backendProcess.stdout?.on('data', (data: Buffer) => {
        console.log(`Backend: ${data}`);
        if (data.toString().includes('listening on')) {
          resolve();
        }
      });

      backendProcess.stderr?.on('data', (data: Buffer) => {
        console.error(`Backend Error: ${data}`);
      });

      backendProcess.on('error', reject);
    });
  }

  function runCommand(command: string, cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const [cmd, ...args] = command.split(' ');
      const p = spawn(cmd, args, { cwd, shell: true });
      p.on('exit', (code: number) => {
        if (code === 0) resolve();
        else reject(new Error(`Command failed: ${command} with code ${code}`));
      });
    });
  }

  it('should follow the integration scenario', async () => {
    await startBackend();
    const api = new BackendApi(BACKEND_URL);

    // 3) Make an issue in component "all" as user "test"
    // First we need to find the ID of component "all"
    const componentListResult = await api.get_component_list('admin');
    expect(componentListResult.ok).toBe(true);
    const components = componentListResult.unsafeUnwrap();
    expect(components).toContain('all');
    expect(components).toContain('admin');

    // Dynamically find IDs for "admin" and "all"
    let adminId = -1;
    let allId = -1;

    // We can't easily search by name via API yet without knowing the ID,
    // so let's iterate IDs 1 to 10 to find them (in a real scenario we'd have a better way)
    for (let id = 1; id <= 10; id++) {
      const metaRes = await api.get_component_metadata('admin', id);
      if (metaRes.ok) {
        const meta = metaRes.unsafeUnwrap();
        if (meta.name === 'Admin') adminId = id;
        if (meta.name === 'all') allId = id;
      }
    }

    expect(adminId).not.toBe(-1);
    expect(allId).not.toBe(-1);

    // Get metadata for "all" to get its ID
    const allMetaResult = await api.get_component_metadata('admin', allId);
    expect(allMetaResult.ok).toBe(true);
    const allMeta = allMetaResult.unsafeUnwrap();
    expect(allMeta.name).toBe('all');

    const createBugRequest: CreateBugRequest = {
      component_id: allMeta.id,
      template_name: '', // Default template
      title: 'Test Bug',
      description: 'Test Description',
      collaborators: [],
      cc: []
    };

    const createBugResult = await api.create_bug('test', createBugRequest);
    expect(createBugResult.ok).toBe(true);

    // 4) Use admin to change meta for component "Admin" removing public from the access.
    // First get "Admin" metadata
    const adminCompMetaResult = await api.get_component_metadata('admin', adminId);
    expect(adminCompMetaResult.ok).toBe(true);
    let adminCompMeta = adminCompMetaResult.unsafeUnwrap();
    expect(adminCompMeta.name).toBe('Admin');

    // Remove "PUBLIC" from "Issue Contributors" or any group that has it
    for (const groupName in adminCompMeta.access_control.groups) {
      const group = adminCompMeta.access_control.groups[groupName];
      group.members = group.members.filter((m: string) => m !== 'PUBLIC');
    }

    // Update metadata
    const updateResult = await api.update_component_metadata('admin', adminId, adminCompMeta);
    expect(updateResult.ok).toBe(true);

    // 5) As user "test" use get component list, we expect the "Admin" component to be missing.
    const testCompListResult = await api.get_component_list('test');
    expect(testCompListResult.ok).toBe(true);
    const testComponents = testCompListResult.unsafeUnwrap();
    
    // "Admin" (sanitized to "admin") should be missing, but "all" should be present.
    expect(testComponents).not.toContain('admin');
    expect(testComponents).toContain('all');
  }, 30000);
});
