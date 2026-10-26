const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const ROOT = path.join(process.env.RUNNER_TEMP, 'release-recovery');
fs.mkdirSync(ROOT, { recursive: true });
const REPO = 'Ahdeyyy/typwriter';
const SOURCE = 424594966;
const TARGET = 424594998;
const assert = require('node:assert/strict');
const gh = (...args) => execFileSync('gh', args.map(String), { maxBuffer: 8 * 1024 * 1024 });
const api = p => JSON.parse(gh('api', p));
const save = (name, data) => fs.writeFileSync(path.join(ROOT, name), JSON.stringify(data, null, 2) + '\n');
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return 'sha256:' + hash.digest('hex');
}
async function download(asset, folder) {
  const destination = path.join(ROOT, folder, asset.name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (!fs.existsSync(destination) || fs.statSync(destination).size !== asset.size) {
    const fd = fs.openSync(destination, 'w');
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('gh', ['api', asset.url, '-H', 'Accept: application/octet-stream'], { stdio: ['ignore', fd, 'pipe'] });
        let error = '';
        child.stderr.on('data', chunk => error += chunk);
        child.on('error', reject);
        child.on('close', code => code === 0 ? resolve() : reject(new Error(error)));
      });
    } finally { fs.closeSync(fd); }
  }
  assert.equal(await digest(destination), asset.digest, asset.name);
  console.log('Verified', folder, asset.name);
  return destination;
}
(async () => {
  const source = api(`repos/${REPO}/releases/${SOURCE}`);
  const target = api(`repos/${REPO}/releases/${TARGET}`);
  assert(source.draft && !target.draft);
  assert.equal(source.tag_name, 'typwriter-v0.9.3');
  assert.equal(source.tag_name, target.tag_name);
  assert.equal(source.target_commitish, target.target_commitish);
  save('source-release.json', source);
  save('target-release-before.json', target);
  const missing = source.assets.filter(a => !target.assets.some(b => a.name === b.name));
  const tasks = missing.concat(source.assets.find(a => a.name === 'latest.json')).map(a => [a, 'source']);
  tasks.push([target.assets.find(a => a.name === 'latest.json'), 'published']);
  let index = 0;
  await Promise.all(Array.from({length: 4}, async () => {
    while (index < tasks.length) await download(...tasks[index++]);
  }));
  const merged = JSON.parse(fs.readFileSync(path.join(ROOT, 'published/latest.json')));
  const other = JSON.parse(fs.readFileSync(path.join(ROOT, 'source/latest.json')));
  assert.equal(merged.version, '0.9.3'); assert.equal(merged.version, other.version);
  for (const [platform, entry] of Object.entries(other.platforms)) {
    if (merged.platforms[platform]) assert.deepEqual(merged.platforms[platform], entry);
    merged.platforms[platform] = entry;
  }
  const allAssets = new Map([...source.assets, ...target.assets].map(a => [a.name, a]));
  for (const [platform, entry] of Object.entries(merged.platforms)) {
    const name = decodeURIComponent(new URL(entry.url).pathname.split('/').pop());
    assert.equal(entry.url, `https://github.com/${REPO}/releases/download/typwriter-v0.9.3/${encodeURIComponent(name)}`);
    assert(allAssets.has(name) && allAssets.has(name + '.sig'), platform);
    const signature = allAssets.get(name + '.sig');
    const folder = source.assets.some(a => a.id === signature.id) ? 'source' : 'published';
    assert.equal(fs.readFileSync(await download(signature, folder), 'utf8').trim(), entry.signature.trim(), platform);
  }
  save('latest.json', merged);
  console.log('Prepared recovery:', missing.length, 'missing assets;', Object.keys(merged.platforms).length, 'updater entries');
  if (!process.argv.includes('--apply')) return;
  async function upload(file, name = path.basename(file)) {
    const endpoint = `https://uploads.github.com/repos/${REPO}/releases/${TARGET}/assets?name=${encodeURIComponent(name)}`;
    const result = JSON.parse(gh('api', '--method', 'POST', endpoint, '-H', 'Content-Type: application/octet-stream', '--input', file));
    assert.equal(result.digest, await digest(file));
    console.log('Uploaded and verified', name);
    return result;
  }
  for (const asset of missing) {
    const current = api(`repos/${REPO}/releases/${TARGET}`);
    const existing = current.assets.find(a => a.name === asset.name);
    if (existing) { assert.equal(existing.digest, asset.digest); continue; }
    await upload(path.join(ROOT, 'source', asset.name));
  }
  const replacement = await upload(path.join(ROOT, 'latest.json'), 'latest-recovered.json');
  const current = api(`repos/${REPO}/releases/${TARGET}`);
  const old = current.assets.find(a => a.name === 'latest.json');
  gh('api', '--method', 'PATCH', `repos/${REPO}/releases/assets/${old.id}`, '-f', 'name=latest-before-recovery.json');
  try {
    gh('api', '--method', 'PATCH', `repos/${REPO}/releases/assets/${replacement.id}`, '-f', 'name=latest.json');
  } catch (error) {
    gh('api', '--method', 'PATCH', `repos/${REPO}/releases/assets/${old.id}`, '-f', 'name=latest.json');
    throw error;
  }
  const final = api(`repos/${REPO}/releases/${TARGET}`);
  for (const [name, asset] of allAssets) {
    const uploaded = final.assets.find(a => a.name === name);
    assert(uploaded, name);
    if (name !== 'latest.json') assert.equal(uploaded.digest, asset.digest, name);
  }
  const manifest = final.assets.find(a => a.name === 'latest.json');
  assert.deepEqual(JSON.parse(gh('api', manifest.url, '-H', 'Accept: application/octet-stream')), merged);
  save('target-release-after.json', final);
  gh('api', '--method', 'DELETE', `repos/${REPO}/releases/assets/${old.id}`);
  gh('api', '--method', 'DELETE', `repos/${REPO}/releases/${SOURCE}`);
  console.log('Recovery complete:', allAssets.size, 'assets, one published release, all four desktop updater targets.');
})().catch(error => { console.error(error); process.exitCode = 1; });
