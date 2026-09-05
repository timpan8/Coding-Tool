/** Explicit maintainer command. Publishes only the verified static dist tree. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr || result.error?.message || ''}`);
  return result.stdout.trim();
}
const root = resolve('.');
const remote = run('git', ['remote', 'get-url', 'origin']);
if (remote !== 'https://github.com/timpan8/Coding-Tool.git') throw new Error('Unexpected publication repository.');
if (!existsSync('dist/sw.js') || !readFileSync('dist/index.html', 'utf8').includes("connect-src 'none'")) throw new Error('Build the production app first.');
run(process.execPath, ['scripts/check-network.mjs']);
const sourceCommit = run('git', ['rev-parse', 'HEAD']);
const remoteBranch = run('git', ['ls-remote', '--heads', 'origin', 'gh-pages']);
let parent = '';
if (remoteBranch) { run('git', ['fetch', 'origin', 'gh-pages']); parent = run('git', ['rev-parse', 'FETCH_HEAD']); }
const temp = mkdtempSync(join(tmpdir(), 'acv-pages-index-'));
const env = { ...process.env, GIT_DIR: join(root, '.git'), GIT_WORK_TREE: join(root, 'dist'), GIT_INDEX_FILE: join(temp, 'index'),
  GIT_AUTHOR_NAME: 'Codex', GIT_AUTHOR_EMAIL: 'codex@users.noreply.github.com', GIT_COMMITTER_NAME: 'Codex', GIT_COMMITTER_EMAIL: 'codex@users.noreply.github.com' };
run('git', ['read-tree', '--empty'], { env });
run('git', ['add', '--all'], { env, cwd: join(root, 'dist') });
const tree = run('git', ['write-tree'], { env });
const commit = run('git', ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Publish static AI Code Vault from ${sourceCommit.slice(0, 12)}`], { env });
run('git', ['push', 'origin', `${commit}:refs/heads/gh-pages`]);
console.log(`Published static tree ${commit.slice(0, 12)} to gh-pages. GitHub Pages build must still be verified.`);
